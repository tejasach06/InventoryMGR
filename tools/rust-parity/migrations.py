#!/usr/bin/env python3
"""Check empty, repeated, and historical upgrades in an owned disposable database."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from verify import ROOT, command, free_port, wait_ready

CATALOG = """
SELECT jsonb_build_object(
'columns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name, ordinal_position)
 FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
 FROM information_schema.columns WHERE table_schema='public') c),
'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,conname)
 FROM (SELECT cl.relname table_name,co.conname,pg_get_constraintdef(co.oid) definition
 FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid
 JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE ns.nspname='public') c),
'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY tablename,indexname)
 FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') i),
'enums', (SELECT jsonb_agg(to_jsonb(e) ORDER BY typname,enumsortorder)
 FROM (SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
 JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') e));
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rust-binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    container = 'inventorymgr-rust-parity-' + secrets.token_hex(6)
    processes = []
    results = {}
    try:
        command('podman', 'run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27')
        port = int(command('podman', 'port', container, '5432/tcp').rsplit(':', 1)[1])
        for _ in range(100):
            if subprocess.run(['podman', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('PostgreSQL readiness timed out')

        def sql(db, text):
            return command('podman', 'exec', container, 'psql', '-U', 'postgres', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', text)

        def env(db, http_port):
            return dict(os.environ, APP_ENV='test', DATABASE_URL=f'postgresql://postgres@127.0.0.1:{port}/{db}', JWT_SECRET=secrets.token_hex(32), HOST='127.0.0.1', PORT=str(http_port), BIND_ADDR=f'127.0.0.1:{http_port}', BACKUP_DIR=str(args.output / 'backups'))

        def alembic(db, revision):
            environment = env(db, free_port())
            environment['DATABASE_URL'] = environment['DATABASE_URL'].replace('postgresql://', 'postgresql+psycopg://')
            command(str(ROOT / 'backend/.venv/bin/python'), '-m', 'alembic', 'upgrade', revision, cwd=ROOT / 'backend', env=environment)

        def native(db, label):
            http_port = free_port()
            with (args.output / (label + '.log')).open('w') as log:
                process = subprocess.Popen([str(args.rust_binary.resolve())], cwd=ROOT / 'backend', env=env(db, http_port), stdout=log, stderr=subprocess.STDOUT)
                processes.append(process)
                wait_ready(process, http_port)
                process.terminate()
                process.wait(timeout=20)
            actual = json.loads(sql(db, CATALOG))
            (args.output / (label + '.json')).write_text(json.dumps(actual, indent=2) + '\n')
            if actual != expected:
                raise RuntimeError(f'{label}: native catalog differs from Python Alembic head; inspect catalog JSON artifacts')
            if sql(db, 'SELECT version_num FROM alembic_version') != head:
                raise RuntimeError(f'{label}: alembic_version is not Python head')
            results[label] = 'passed'

        for database in ('parity_reference', 'parity_empty', 'parity_upgrade'):
            command('podman', 'exec', container, 'createdb', '-U', 'postgres', database)
        alembic('parity_reference', 'head')
        head = sql('parity_reference', 'SELECT version_num FROM alembic_version')
        expected = json.loads(sql('parity_reference', CATALOG))
        (args.output / 'python-head.json').write_text(json.dumps(expected, indent=2) + '\n')
        native('parity_empty', 'empty')
        native('parity_empty', 'repeated')
        alembic('parity_upgrade', '0001_initial')
        sql('parity_upgrade', "INSERT INTO users(id,email,password_hash,role,is_active,created_at,updated_at) VALUES ('00000000-0000-0000-0000-000000000123','migration@parity.test','not-a-login-password','viewer',true,now(),now())")
        native('parity_upgrade', 'historical-upgrade')
        if sql('parity_upgrade', "SELECT email FROM users WHERE id='00000000-0000-0000-0000-000000000123'") != 'migration@parity.test':
            raise RuntimeError('Historical upgrade lost the sentinel user')
        results['historical-row-preserved'] = 'passed'
        (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps(results))
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        subprocess.run(['podman', 'rm', '--force', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
