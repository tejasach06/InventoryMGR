#!/usr/bin/env python3
"""Exercise real destructive restore and concurrent HTTP writes on owned PostgreSQL."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import copy
import json
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

from verify import Client, PASSWORD, ROOT, command, free_port, wait_ready


def wait_until(predicate, message, timeout=30):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise RuntimeError(message)
        time.sleep(.02)


def clone_client(client, port):
    result = Client(port)
    for cookie in client.cookies:
        result.cookies.set_cookie(copy.copy(cookie))
    return result


def signed_token(claims, secret):
    def encoded(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    payload = encoded({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encoded(claims)
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload, hashlib.sha256).digest()).rstrip(b'=')
    return (payload + b'.' + signature).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rust-binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--observe-lifecycle-before', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    container = 'inventorymgr-rust-parity-' + secrets.token_hex(6)
    process = None
    locker = None
    results = {}
    with tempfile.TemporaryDirectory(prefix='inventorymgr-restore-') as temporary:
        scratch = Path(temporary)
        release = scratch / 'restore-release'
        try:
            command('podman', 'run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27')
            port = int(command('podman', 'port', container, '5432/tcp').rsplit(':', 1)[1])
            wait_until(lambda: subprocess.run(['podman', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0, 'PostgreSQL readiness timed out')
            command('podman', 'exec', container, 'createdb', '-U', 'postgres', 'parity_restore')

            def sql(text, database='parity_restore'):
                return command('podman', 'exec', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', text)

            pg_bin = scratch / 'pg-bin'
            pg_bin.mkdir()
            bridge = (ROOT / 'tools/rust-parity/pg_bridge.py').read_text()
            barrier = """        import time
        Path(os.environ['PARITY_RESTORE_ENTERED']).touch()
        deadline = time.monotonic() + 30
        while not Path(os.environ['PARITY_RESTORE_RELEASE']).exists():
            if time.monotonic() >= deadline:
                raise RuntimeError('Restore barrier timed out')
            time.sleep(.01)
"""
            barrier = "        if any(arg.startswith('--dbname=') and arg.endswith('/parity_restore') for arg in args):\n" + ''.join('    ' + line + '\n' for line in barrier.splitlines())
            for name in ('pg_dump', 'pg_restore'):
                wrapper = pg_bin / name
                wrapper.write_text(bridge.replace("    elif binary == 'pg_restore':\n", "    elif binary == 'pg_restore':\n" + barrier) if name == 'pg_restore' else bridge)
                wrapper.chmod(0o700)
            http_port = free_port()
            environment = dict(os.environ, APP_ENV='test', DATABASE_URL=f'postgresql://postgres@127.0.0.1:{port}/parity_restore', JWT_SECRET=secrets.token_hex(32), HOST='127.0.0.1', PORT=str(http_port), BACKUP_DIR=str(scratch / 'backups'), PG_BIN_DIR=str(pg_bin), PARITY_PG_CONTAINER=container, PARITY_PG_URL='postgresql://postgres@127.0.0.1:5432/parity_restore', PARITY_RESTORE_ENTERED=str(scratch / 'restore-entered'), PARITY_RESTORE_RELEASE=str(release))
            with (args.output / 'backend.log').open('w') as log:
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                admin = Client(http_port)
                admin.must('POST', '/api/auth/setup', {'email': 'admin@parity.test', 'password': PASSWORD})
                slow_login = socket.create_connection(('127.0.0.1', http_port), timeout=2)
                anonymous_restore = socket.create_connection(('127.0.0.1', http_port), timeout=2)
                try:
                    slow_login.sendall(b'POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{')
                    time.sleep(.1)
                    anonymous_restore.sendall(b'POST /api/backups/restore HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=slow\r\nContent-Length: 100\r\n\r\n')
                    time.sleep(.1)
                    probe = socket.create_connection(('127.0.0.1', http_port), timeout=2)
                    try:
                        probe.sendall(b'GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                        assert b'200 OK' in probe.recv(4096), 'Slow anonymous bodies blocked health'
                    finally:
                        probe.close()
                    admin.must('GET', '/api/auth/me')
                    assert b'401 Unauthorized' in anonymous_restore.recv(4096), 'Anonymous restore waited for its body'
                finally:
                    slow_login.close()
                    anonymous_restore.close()
                results['slow_anonymous_bodies_do_not_block_health'] = True
                oversized_status, _, _ = Client(http_port).request('POST', '/api/auth/login', {'email': 'x' * (2 * 1024 * 1024), 'password': PASSWORD})
                assert oversized_status == 413, f'Oversized anonymous body was not rejected before parsing: {oversized_status}'
                results['ordinary_body_limit_413'] = True
                vm = {'platform': 'proxmox', 'cluster': 'restore-parity', 'status': 'running', 'cpu_cores': 1, 'memory_mb': 1024, 'criticality': 'low'}
                sentinel = admin.must('POST', '/api/vms', dict(vm, name='snapshot-sentinel'))
                backup = admin.must('POST', '/api/backups')
                _, _, archive = admin.request('GET', '/api/backups/' + backup['filename'] + '/download')
                slow_restore = socket.create_connection(('127.0.0.1', http_port), timeout=5)
                cookie_header = '; '.join(cookie.name + '=' + cookie.value for cookie in admin.cookies)
                csrf_token = next(cookie.value for cookie in admin.cookies if cookie.name == 'inventorymgr_csrf')
                try:
                    headers = f'POST /api/backups/restore HTTP/1.1\r\nHost: localhost\r\nCookie: {cookie_header}\r\nX-CSRF-Token: {csrf_token}\r\nContent-Type: multipart/form-data; boundary=slow\r\nContent-Length: 100\r\n\r\n'
                    slow_restore.sendall(headers.encode())
                    time.sleep(.2)
                    admin.must('GET', '/api/auth/me')
                    during_upload = admin.must('POST', '/api/vms', dict(vm, name='write-during-upload'))
                    admin.must('DELETE', '/api/vms/' + during_upload['id'])
                finally:
                    slow_restore.close()
                results['authenticated_slow_upload_does_not_hold_gate'] = True
                uploader_user = admin.must('POST', '/api/users', {'email': 'upload-admin@parity.test', 'password': PASSWORD, 'role': 'admin'})
                uploader = Client(http_port)
                uploader.must('POST', '/api/auth/login', {'email': 'upload-admin@parity.test', 'password': PASSWORD})
                cookie_header = '; '.join(cookie.name + '=' + cookie.value for cookie in uploader.cookies)
                csrf_token = next(cookie.value for cookie in uploader.cookies if cookie.name == 'inventorymgr_csrf')
                upload_body = b'--slow\r\nContent-Disposition: form-data; name="confirm"\r\n\r\nRESTORE\r\n--slow\r\nContent-Disposition: form-data; name="file"; filename="parity.dump"\r\nContent-Type: application/octet-stream\r\n\r\n' + archive + b'\r\n--slow--\r\n'
                slow_restore = socket.create_connection(('127.0.0.1', http_port), timeout=20)
                before_revoked_restore = sql("SELECT count(*) FROM backup_jobs")
                try:
                    headers = f'POST /api/backups/restore HTTP/1.1\r\nHost: localhost\r\nCookie: {cookie_header}\r\nX-CSRF-Token: {csrf_token}\r\nContent-Type: multipart/form-data; boundary=slow\r\nContent-Length: {len(upload_body)}\r\n\r\n'
                    slow_restore.sendall(headers.encode() + upload_body[:200])
                    time.sleep(.2)
                    admin.must('GET', '/api/auth/me')
                    sql("UPDATE users SET role='viewer' WHERE id='" + uploader_user['id'] + "'")
                    slow_restore.sendall(upload_body[200:])
                    assert b'403 Forbidden' in slow_restore.recv(4096), 'Restore did not revalidate admin role after upload'
                finally:
                    slow_restore.close()
                assert sql("SELECT count(*) FROM backup_jobs") == before_revoked_restore, 'Revoked uploader created a recovery backup'
                wait_until(lambda: sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%'") == '0', 'Staging database leaked after revoked upload')
                results['restore_admin_revalidated_after_upload'] = True
                before_jobs = sql("SELECT count(*) FROM backup_jobs")
                invalid_status, invalid_body, _ = admin.request('POST', '/api/backups/restore', upload=('invalid.dump', b'PGDMPinvalid', 'application/octet-stream', {'confirm': 'RESTORE'}))
                assert invalid_status == 400, f'Invalid custom archive reported success: {invalid_status} {invalid_body}'
                assert sql("SELECT count(*) FROM backup_jobs") == before_jobs, 'Invalid archive created a recovery backup or restore job'
                assert sql("SELECT count(*) FROM vms WHERE name='snapshot-sentinel'") == '1', 'Invalid archive changed the database'
                admin.must('GET', '/api/auth/me')
                results['invalid_archive_rejected_without_changes'] = True

                with ThreadPoolExecutor(max_workers=2) as workers:
                    clients = [clone_client(admin, http_port) for _ in range(2)]
                    concurrent = list(workers.map(lambda client: client.must('POST', '/api/backups'), clients))
                names = [job['filename'] for job in concurrent]
                assert len(set(names)) == 2, f'Concurrent backups collided: {names}'
                for name in names:
                    _, _, content = admin.request('GET', '/api/backups/' + name + '/download')
                    candidate = scratch / name
                    candidate.write_bytes(content)
                    subprocess.run([str(pg_bin / 'pg_restore'), '--file=-', str(candidate)], env=environment, stdout=subprocess.DEVNULL, check=True)
                    admin.must('DELETE', '/api/backups/' + name)
                results['concurrent_manual_archives_distinct_and_readable'] = True

                admin.must('PATCH', '/api/backups/settings', {'retention': 1})
                dump_entered = scratch / 'dump-entered'
                dump_release = scratch / 'dump-release'
                dump_barrier = f"""    if binary == 'pg_dump' and not Path({str(dump_entered)!r}).exists():
        import time
        Path({str(dump_entered)!r}).write_text(output)
        deadline = time.monotonic() + 30
        while not Path({str(dump_release)!r}).exists():
            if time.monotonic() >= deadline:
                raise RuntimeError('Dump barrier timed out')
            time.sleep(.01)
"""
                dump_wrapper = pg_bin / 'pg_dump'
                dump_wrapper.write_text(bridge.replace('    return result.returncode\n', dump_barrier + '    return result.returncode\n'))
                with ThreadPoolExecutor(max_workers=1) as workers:
                    pending = workers.submit(clone_client(admin, http_port).must, 'POST', '/api/backups')
                    try:
                        wait_until(dump_entered.exists, 'Manual dump did not reach barrier')
                        admin.must('POST', '/api/backups')
                        assert Path(dump_entered.read_text()).is_file(), 'Retention removed an in-progress backup'
                    finally:
                        dump_release.touch()
                    pending.result(timeout=30)
                dump_wrapper.write_text(bridge)
                admin.must('PATCH', '/api/backups/settings', {'retention': 7})
                results['retention_preserves_inflight_manual_backup'] = True

                sql("CREATE FUNCTION parity_fail_restore() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_TAG='CREATE TABLE' THEN RAISE EXCEPTION 'parity forced restore failure'; END IF; END $$; CREATE EVENT TRIGGER parity_fail_restore ON ddl_command_start EXECUTE FUNCTION parity_fail_restore()")

                stale = clone_client(admin, http_port)
                release.touch()
                failed_status, failed_body, _ = admin.request('POST', '/api/backups/restore', upload=('parity.dump', archive, 'application/octet-stream', {'confirm': 'RESTORE'}))
                assert failed_status == 500, f'Failed pg_restore reported success: {failed_status} {failed_body}'
                assert sql("SELECT count(*) FROM vms WHERE name='snapshot-sentinel'") == '1', 'Failed transactional restore destroyed existing rows'
                assert sql("SELECT status FROM backup_jobs WHERE kind='restore' ORDER BY started_at DESC LIMIT 1") == 'failed', 'Failed restore job was not marked failed'
                assert stale.request('GET', '/api/auth/me')[0] == 401, 'Failed restore left the old session valid'
                assert stale.request('POST', '/api/auth/refresh')[0] == 401, 'Failed restore left the old refresh valid'
                sql('DROP EVENT TRIGGER parity_fail_restore; DROP FUNCTION parity_fail_restore()')
                release.unlink()
                (scratch / 'restore-entered').unlink()
                admin.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
                assert not (scratch / 'backups' / '.restore-auth-blocked').exists(), 'Recovered failed restore left auth blocked'
                results['failed_restore_rolls_back_and_revokes_sessions'] = True

                restoring_admin = admin.must('POST', '/api/users', {'email': 'later-admin@parity.test', 'password': PASSWORD, 'role': 'admin'})
                requester = Client(http_port)
                requester.must('POST', '/api/auth/login', {'email': 'later-admin@parity.test', 'password': PASSWORD})
                writer = clone_client(admin, http_port)
                before_restore = clone_client(admin, http_port)
                token = next(cookie.value for cookie in admin.cookies if cookie.name == 'inventorymgr_session')
                claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
                sql("CREATE FUNCTION parity_block_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(7115123); RETURN NEW; END $$; CREATE TRIGGER parity_block_write BEFORE UPDATE ON vms FOR EACH ROW EXECUTE FUNCTION parity_block_write()")
                locker = subprocess.Popen(['podman', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'parity_restore', '-At', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                locker.stdin.write('SELECT pg_advisory_lock(7115123);\n')
                locker.stdin.flush()
                wait_until(lambda: sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND granted") == '1', 'Query blocker did not acquire its lock')
                with ThreadPoolExecutor(max_workers=2) as workers:
                    inflight = workers.submit(writer.request, 'PATCH', '/api/vms/' + sentinel['id'], {'owner': 'accepted-before-restore'})
                    wait_until(lambda: sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND NOT granted") == '1', 'In-flight HTTP write did not reach PostgreSQL')
                    restore = workers.submit(requester.request, 'POST', '/api/backups/restore', upload=('parity.dump', archive, 'application/octet-stream', {'confirm': 'RESTORE'}))
                    try:
                        wait_until(lambda: (scratch / 'restore-entered').exists(), 'Restore is waiting for the in-flight query', timeout=1)
                        results['restore_waited_for_inflight'] = False
                    except RuntimeError:
                        results['restore_waited_for_inflight'] = True
                    locker.stdin.close()
                    locker.wait(timeout=10)
                    inflight_status, inflight_body, _ = inflight.result(timeout=45)
                    assert inflight_status == 200, f'In-flight write failed: {inflight_status} {inflight_body}'
                    wait_until(lambda: (scratch / 'restore-entered').exists() or restore.done(), 'Restore never reached real pg_restore')
                    if restore.done():
                        raise RuntimeError(f'Restore returned before pg_restore barrier: {restore.result()}')
                    write = workers.submit(writer.request, 'POST', '/api/vms', dict(vm, name='concurrent-write'))
                    try:
                        status, body, _ = write.result(timeout=1)
                        results['write_during_restore'] = {'status': status, 'body': body}
                    except TimeoutError:
                        results['write_during_restore'] = 'blocked'
                    release.touch()
                    restore_status, restore_body, _ = restore.result(timeout=45)
                    write_status, write_body, _ = write.result(timeout=45)
                if restore_status != 200:
                    raise RuntimeError(f'Restore failed: {restore_status} {restore_body}')
                assert restore_body['status'] == 'success' and restore_body['user_id'] is None, f'Restore failed to tolerate missing actor: {restore_body}'
                assert sql("SELECT count(*) FROM users WHERE id='" + restoring_admin['id'] + "'") == '0', 'Restore did not remove the post-snapshot actor'
                assert not (scratch / 'backups' / '.restore-auth-blocked').exists(), 'Successful restore left auth blocked'
                results['missing_restore_actor_logged_as_null'] = True
                epoch = int(sql("SELECT value FROM app_settings WHERE key='session_epoch'"))
                same_second = clone_client(before_restore, http_port)
                for cookie in same_second.cookies:
                    if cookie.name in ('inventorymgr_session', 'inventorymgr_refresh'):
                        old_claims = json.loads(base64.urlsafe_b64decode(cookie.value.split('.')[1] + '=='))
                        old_claims['iat'] = epoch
                        cookie.value = signed_token(old_claims, environment['JWT_SECRET'])
                assert same_second.request('GET', '/api/auth/me')[0] == 401, 'Same-second pre-restore generation survived'
                assert same_second.request('POST', '/api/auth/refresh')[0] == 401, 'Same-second pre-restore refresh survived'
                for cookie in same_second.cookies:
                    if cookie.name in ('inventorymgr_session', 'inventorymgr_refresh'):
                        legacy_claims = json.loads(base64.urlsafe_b64decode(cookie.value.split('.')[1] + '=='))
                        legacy_claims.pop('generation', None)
                        cookie.value = signed_token(legacy_claims, environment['JWT_SECRET'])
                assert same_second.request('GET', '/api/auth/me')[0] == 401, 'Same-second legacy session survived'
                assert same_second.request('POST', '/api/auth/refresh')[0] == 401, 'Same-second legacy refresh survived'
                results['same_second_session_and_refresh_revoked'] = True
                rows = command('podman', 'exec', container, 'psql', '-U', 'postgres', '-d', 'parity_restore', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT count(*) FROM vms WHERE name='concurrent-write'")
                results['write_response'] = write_status
                results['persisted_concurrent_rows'] = int(rows)
                results['restore_status'] = restore_status
                (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
                assert write_status != 201 or int(rows) == 1, f'Acknowledged concurrent write lost: HTTP {write_status}, restored rows {rows}'
                assert results['write_during_restore'] == 'blocked', f'Database write ran during destructive restore: {results["write_during_restore"]}'
                assert write_status == 401, f'Queued pre-restore session was not revalidated: {write_status} {write_body}'
                assert results['restore_waited_for_inflight'], 'Destructive restore began while an HTTP SQL query was in flight'
                command('podman', 'exec', container, 'createdb', '-U', 'postgres', 'parity_recovery')
                recovery = max((scratch / 'backups').glob('*-pre_restore-*.dump'), key=lambda path: path.stat().st_mtime_ns)
                with recovery.open('rb') as incoming:
                    subprocess.run(['podman', 'exec', '-i', container, 'pg_restore', '--no-owner', '--no-privileges', '--dbname=postgresql://postgres@127.0.0.1:5432/parity_recovery'], stdin=incoming, check=True, capture_output=True)
                assert sql("SELECT owner FROM vms WHERE name='snapshot-sentinel'", 'parity_recovery') == 'accepted-before-restore', 'Pre-restore recovery archive omitted the acknowledged in-flight write'
                results['inflight_write_in_recovery_archive'] = 'retained'
                admin.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
                admin.must('POST', '/api/vms', dict(vm, name='accepted-after-restore'))
                assert command('podman', 'exec', container, 'psql', '-U', 'postgres', '-d', 'parity_restore', '-At', '-c', "SELECT count(*) FROM vms WHERE name='accepted-after-restore'") == '1'
                results['fresh_write_after_restore'] = 'persisted'
                restart_stale = clone_client(admin, http_port)
                sql("UPDATE alembic_version SET version_num='parity_unknown'")
                incompatible = admin.must('POST', '/api/backups')
                _, _, incompatible_archive = admin.request('GET', '/api/backups/' + incompatible['filename'] + '/download')
                sql("UPDATE alembic_version SET version_num='0024'")
                before_rejection = sql("SELECT json_build_object('vms',(SELECT jsonb_agg(to_jsonb(v)) FROM vms v),'jobs',(SELECT jsonb_agg(to_jsonb(j)) FROM backup_jobs j),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM app_settings s WHERE key IN ('session_generation','session_epoch')))")
                files_before_rejection = sorted(path.name for path in (scratch / 'backups').iterdir())
                recovery_status, recovery_body, _ = admin.request('POST', '/api/backups/restore', upload=('unknown-revision.dump', incompatible_archive, 'application/octet-stream', {'confirm': 'RESTORE'}))
                assert recovery_status == 400, f'Incompatible archive was not rejected: {recovery_status} {recovery_body}'
                assert not (scratch / 'backups' / '.restore-auth-blocked').exists(), 'Rejected archive created an auth guard'
                assert sql("SELECT json_build_object('vms',(SELECT jsonb_agg(to_jsonb(v)) FROM vms v),'jobs',(SELECT jsonb_agg(to_jsonb(j)) FROM backup_jobs j),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM app_settings s WHERE key IN ('session_generation','session_epoch')))") == before_rejection, 'Rejected archive changed live rows, backup jobs or session generation'
                assert sorted(path.name for path in (scratch / 'backups').iterdir()) == files_before_rejection, 'Rejected archive created recovery side effects'
                wait_until(lambda: sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%'") == '0', 'Staging database leaked after rejection')
                restart_stale.must('GET', '/api/auth/me')
                assert restart_stale.request('POST', '/api/auth/refresh')[0] == 200, 'Rejected archive revoked refresh token'
                results['unknown_revision_rejected_without_live_changes'] = True
                process.terminate()
                process.wait(timeout=20)
                assert process.returncode == 0, f'SIGTERM was not graceful: {process.returncode}'
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                restart_stale.must('GET', '/api/auth/me')
                results['sigterm_graceful_and_tokens_unchanged'] = True

                crash_entered = scratch / 'crash-dump-entered'
                crash_release = scratch / 'crash-dump-release'
                crash_barrier = f"""    if binary == 'pg_dump':
        import time
        Path({str(crash_entered)!r}).write_text(output)
        while not Path({str(crash_release)!r}).exists():
            time.sleep(.01)
"""
                dump_wrapper.write_text(bridge.replace('    return result.returncode\n', crash_barrier + '    return result.returncode\n'))
                with ThreadPoolExecutor(max_workers=1) as workers:
                    interrupted = workers.submit(clone_client(restart_stale, http_port).request, 'POST', '/api/backups')
                    wait_until(crash_entered.exists, 'Crash fixture dump did not reach barrier')
                    partial = Path(crash_entered.read_text())
                    assert partial.suffix == '.partial' and partial.is_file(), 'Running dump was exposed as final archive'
                    second = subprocess.run([str(args.rust_binary.resolve())], env=dict(environment, PORT=str(free_port())), cwd=ROOT / 'backend', stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
                    assert second.returncode != 0 and b'Another InventoryMGR instance' in second.stdout, 'Second instance did not refuse database ownership'
                    assert partial.exists(), 'Second instance reconciled a live backup'
                    process.kill()
                    process.wait(timeout=20)
                    crash_release.touch()
                    try:
                        interrupted.result(timeout=10)
                    except (OSError, RuntimeError):
                        pass
                dump_wrapper.write_text(bridge)
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                assert sql("SELECT count(*) FROM backup_jobs WHERE status='running'") == '0', 'Restart left interrupted jobs running'
                assert sql("SELECT count(*) FROM backup_jobs WHERE status='failed' AND error='Backup interrupted by application shutdown'") != '0', 'Interrupted backup not marked failed'
                assert not partial.exists() and not partial.with_suffix('').exists(), 'Interrupted archive remained downloadable'
                restart_stale.must('GET', '/api/auth/me')
                results['crash_reconciles_partial_backup_with_single_instance_lease'] = True

                lifecycle = {}
                def observed(name, passed):
                    lifecycle[name] = passed
                    (args.output / 'lifecycle.json').write_text(json.dumps(lifecycle, indent=2) + '\n')
                    if not args.observe_lifecycle_before:
                        assert passed, name

                retained = restart_stale.must('POST', '/api/backups')
                _, _, retained_bytes = restart_stale.request('GET', '/api/backups/' + retained['filename'] + '/download')
                status, body, _ = restart_stale.request('POST', '/api/backups/restore', upload=('completed.dump', retained_bytes, 'application/octet-stream', {'confirm': 'RESTORE'}))
                assert status == 200, (status, body)
                assert sql("SELECT status FROM backup_jobs WHERE id='" + retained['id'] + "'") == 'running'
                process.terminate()
                process.wait(timeout=20)
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                retained_path = scratch / 'backups' / retained['filename']
                readable = retained_path.exists()
                if readable:
                    subprocess.run([str(pg_bin / 'pg_restore'), '--file=-', str(retained_path)], env=environment, stdout=subprocess.DEVNULL, check=True)
                observed('completed_archive_survives_restore_restart', readable)
                restart_stale = Client(http_port)
                restart_stale.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})

                live_oid = sql("SELECT oid::bigint FROM pg_database WHERE datname=current_database()")
                prefix = 'im_restore_' + live_oid + '_'
                controls = [prefix + 'unrelated', 'im_restore_4294967295_' + secrets.token_hex(16), 'inventorymgr_restore_' + secrets.token_hex(16), prefix + secrets.token_hex(16)]
                sql("CREATE ROLE parity_other")
                for name in controls:
                    sql('CREATE DATABASE ' + name + (' OWNER parity_other' if name == controls[-1] else ''))
                stage_entered = scratch / 'stage-entered'
                stage_release = scratch / 'stage-release'
                stage_barrier = f"""        if any(arg.startswith('--dbname=') and not arg.endswith('/parity_restore') for arg in args):
            import time
            Path({str(stage_entered)!r}).touch()
            while not Path({str(stage_release)!r}).exists():
                time.sleep(.01)
"""
                (pg_bin / 'pg_restore').write_text(bridge.replace("    elif binary == 'pg_restore':\n", "    elif binary == 'pg_restore':\n" + stage_barrier))
                with ThreadPoolExecutor(max_workers=1) as workers:
                    staging_request = workers.submit(clone_client(restart_stale, http_port).request, 'POST', '/api/backups/restore', upload=('crash.dump', retained_bytes, 'application/octet-stream', {'confirm': 'RESTORE'}))
                    wait_until(stage_entered.exists, 'Staging did not reach crash barrier')
                    orphan = sql("SELECT datname FROM pg_database WHERE (datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%') AND datname NOT IN (" + ','.join("'" + name + "'" for name in controls) + ")")
                    assert orphan and len(orphan) < 63
                    process.kill()
                    process.wait(timeout=20)
                    stage_release.touch()
                    try:
                        staging_request.result(timeout=15)
                    except (OSError, RuntimeError):
                        pass
                (pg_bin / 'pg_restore').write_text(bridge.replace("    elif binary == 'pg_restore':\n", "    elif binary == 'pg_restore':\n" + barrier))
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                observed('crash_orphan_reclaimed', sql("SELECT count(*) FROM pg_database WHERE datname='" + orphan + "'") == '0')
                observed('unrelated_scope_role_names_preserved', all(sql("SELECT count(*) FROM pg_database WHERE datname='" + name + "'") == '1' for name in controls))
                if args.observe_lifecycle_before:
                    sql('DROP DATABASE IF EXISTS ' + orphan + ' WITH (FORCE)')
                for name in controls:
                    sql('DROP DATABASE ' + name + ' WITH (FORCE)')

                lease_pid = sql("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1 AND objid=3978674610")
                assert lease_pid.isdigit(), 'Dedicated lease session not found'
                sql('SELECT pg_terminate_backend(' + lease_pid + ')')
                deadline = time.monotonic() + 10
                while process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.05)
                observed('lease_loss_exits_fail_closed', process.poll() is not None and process.returncode != 0)
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=20)
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                observed('replacement_acquires_lease_after_loss', True)
                restart_stale = Client(http_port)
                restart_stale.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
                drain_entered = scratch / 'drain-entered'
                drain_release = scratch / 'drain-release'
                drain_barrier = f"""    if binary == 'pg_dump':
        import time
        Path({str(drain_entered)!r}).touch()
        while not Path({str(drain_release)!r}).exists():
            time.sleep(.01)
"""
                dump_wrapper.write_text(bridge.replace('    return result.returncode\n', drain_barrier + '    return result.returncode\n'))
                with ThreadPoolExecutor(max_workers=1) as workers:
                    draining = workers.submit(clone_client(restart_stale, http_port).request, 'POST', '/api/backups')
                    try:
                        wait_until(drain_entered.exists, 'Drain backup did not reach barrier')
                        process.terminate()
                        time.sleep(.2)
                        assert process.poll() is None, 'SIGTERM did not drain the in-flight backup'
                        second = subprocess.run([str(args.rust_binary.resolve())], env=dict(environment, PORT=str(free_port())), cwd=ROOT / 'backend', stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
                        assert second.returncode != 0 and b'Another InventoryMGR instance' in second.stdout, 'Lease released before graceful drain finished'
                    finally:
                        drain_release.touch()
                    assert draining.result(timeout=20)[0] == 201
                process.wait(timeout=20)
                assert process.returncode == 0
                observed('lease_retained_through_graceful_drain', True)
                dump_wrapper.write_text(bridge)
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                results.update(lifecycle)

                process.terminate()
                process.wait(timeout=20)
                assert process.returncode == 0, 'SIGTERM after restart failed'
                (scratch / 'backups' / '.restore-auth-blocked').touch()
                process = subprocess.Popen([str(args.rust_binary.resolve())], env=environment, cwd=ROOT / 'backend', stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, http_port)
                assert restart_stale.request('GET', '/api/auth/me')[0] == 401, 'Restart ignored restore-auth guard'
                assert restart_stale.request('POST', '/api/auth/refresh')[0] == 401, 'Restart ignored restore-auth guard for refresh'
                assert Client(http_port).request('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})[0] == 401, 'Restart issued tokens before restore recovery'
                assert (scratch / 'backups' / '.restore-auth-blocked').exists(), 'Startup reconciliation removed restore-auth guard'
                results['restore_marker_remains_fail_closed_after_restart'] = True
                (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
                print(json.dumps(results))
        finally:
            release.touch()
            if locker is not None and locker.poll() is None:
                if not locker.stdin.closed:
                    locker.stdin.close()
                locker.wait(timeout=10)
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            subprocess.run(['podman', 'rm', '--force', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()

