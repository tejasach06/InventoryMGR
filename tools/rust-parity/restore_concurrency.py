#!/usr/bin/env python3
"""Exercise real destructive restore and concurrent HTTP writes on owned PostgreSQL."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import copy
import json
import os
from pathlib import Path
import secrets
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rust-binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
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
            command('podman', 'run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'docker.io/library/postgres:17')
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
                vm = {'platform': 'proxmox', 'cluster': 'restore-parity', 'status': 'running', 'cpu_cores': 1, 'memory_mb': 1024, 'criticality': 'low'}
                sentinel = admin.must('POST', '/api/vms', dict(vm, name='snapshot-sentinel'))
                backup = admin.must('POST', '/api/backups')
                _, _, archive = admin.request('GET', '/api/backups/' + backup['filename'] + '/download')
                writer = Client(http_port)
                for cookie in admin.cookies:
                    writer.cookies.set_cookie(copy.copy(cookie))
                token = next(cookie.value for cookie in admin.cookies if cookie.name == 'inventorymgr_session')
                claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
                wait_until(lambda: int(time.time()) > claims['iat'], 'Session clock readiness timed out')
                sql("CREATE FUNCTION parity_block_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(7115123); RETURN NEW; END $$; CREATE TRIGGER parity_block_write BEFORE UPDATE ON vms FOR EACH ROW EXECUTE FUNCTION parity_block_write()")
                locker = subprocess.Popen(['podman', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'parity_restore', '-At', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                locker.stdin.write('SELECT pg_advisory_lock(7115123);\n')
                locker.stdin.flush()
                wait_until(lambda: sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND granted") == '1', 'Query blocker did not acquire its lock')
                with ThreadPoolExecutor(max_workers=2) as workers:
                    inflight = workers.submit(writer.request, 'PATCH', '/api/vms/' + sentinel['id'], {'owner': 'accepted-before-restore'})
                    wait_until(lambda: sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND NOT granted") == '1', 'In-flight HTTP write did not reach PostgreSQL')
                    restore = workers.submit(admin.request, 'POST', '/api/backups/restore', upload=('parity.dump', archive, 'application/octet-stream', {'confirm': 'RESTORE'}))
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
                recovery = next((scratch / 'backups').glob('*-pre_restore.dump'))
                with recovery.open('rb') as incoming:
                    subprocess.run(['podman', 'exec', '-i', container, 'pg_restore', '--no-owner', '--no-privileges', '--dbname=postgresql://postgres@127.0.0.1:5432/parity_recovery'], stdin=incoming, check=True, capture_output=True)
                assert sql("SELECT owner FROM vms WHERE name='snapshot-sentinel'", 'parity_recovery') == 'accepted-before-restore', 'Pre-restore recovery archive omitted the acknowledged in-flight write'
                results['inflight_write_in_recovery_archive'] = 'retained'
                admin.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
                admin.must('POST', '/api/vms', dict(vm, name='accepted-after-restore'))
                assert command('podman', 'exec', container, 'psql', '-U', 'postgres', '-d', 'parity_restore', '-At', '-c', "SELECT count(*) FROM vms WHERE name='accepted-after-restore'") == '1'
                results['fresh_write_after_restore'] = 'persisted'
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
