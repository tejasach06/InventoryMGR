#!/usr/bin/env python3
"""Invoke the disposable container's real PostgreSQL client binaries."""
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


def main():
    binary = Path(sys.argv[0]).name
    args = sys.argv[1:]
    container = os.environ['PARITY_PG_CONTAINER']
    url = os.environ['PARITY_PG_URL']
    target = urlsplit(url)
    parity = container.startswith('inventorymgr-rust-parity-') and target.path in ('/parity_python', '/parity_rust', '/parity_restore')
    e2e = container.startswith('inventorymgr-e2e-') and target.path == '/inventorymgr_e2e'
    if target.scheme != 'postgresql' or target.netloc != 'postgres@127.0.0.1:5432' or not (parity or e2e):
        raise RuntimeError('Refusing a non-disposable PostgreSQL target')

    def forwarded_url(supplied):
        database = urlsplit(supplied).path
        if database != target.path:
            live_oid = subprocess.check_output(['podman', 'exec', container, 'psql', url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
                'SELECT oid::bigint FROM pg_database WHERE datname=current_database()'], text=True).strip()
            if not live_oid.isdigit() or not re.fullmatch(r'/im_restore_' + live_oid + r'_[0-9a-f]{32}', database):
                raise RuntimeError('Refusing an unowned PostgreSQL database')
        return target._replace(path=database).geturl()

    if binary == 'pg_dump':
        output = next(arg.split('=', 1)[1] for arg in args if arg.startswith('--file='))
        forwarded = [arg for arg in args if not arg.startswith('--file=') and not arg.startswith('postgresql://')]
        dump_url = forwarded_url(next(arg for arg in args if arg.startswith('postgresql://')))
        with open(output, 'wb') as destination:
            result = subprocess.run(['podman', 'exec', container, 'pg_dump', *forwarded, dump_url], stdout=destination)
    elif binary == 'pg_restore':
        source = args[-1]
        forwarded = [f'--dbname={forwarded_url(arg.split("=", 1)[1])}' if arg.startswith('--dbname=') else arg for arg in args[:-1]]
        with open(source, 'rb') as incoming:
            result = subprocess.run(['podman', 'exec', '-i', container, 'pg_restore', *forwarded], stdin=incoming)
    else:
        raise RuntimeError(f'Unexpected PostgreSQL binary {binary}')
    return result.returncode


if __name__ == '__main__':
    sys.exit(main())
