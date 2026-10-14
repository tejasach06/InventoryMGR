#!/usr/bin/env python3
"""Invoke the disposable container's real PostgreSQL client binaries."""
import os
from pathlib import Path
import subprocess
import sys


def main():
    binary = Path(sys.argv[0]).name
    args = sys.argv[1:]
    container = os.environ['PARITY_PG_CONTAINER']
    url = os.environ['PARITY_PG_URL']
    if not container.startswith('inventorymgr-rust-parity-') or '/parity_' not in url:
        raise RuntimeError('Refusing a non-parity PostgreSQL target')
    if binary == 'pg_dump':
        output = next(arg.split('=', 1)[1] for arg in args if arg.startswith('--file='))
        forwarded = [arg for arg in args if not arg.startswith('--file=') and not arg.startswith('postgresql://')]
        with open(output, 'wb') as destination:
            result = subprocess.run(['podman', 'exec', container, 'pg_dump', *forwarded, url], stdout=destination)
    elif binary == 'pg_restore':
        source = args[-1]
        forwarded = [f'--dbname={url}' if arg.startswith('--dbname=') else arg for arg in args[:-1]]
        with open(source, 'rb') as incoming:
            result = subprocess.run(['podman', 'exec', '-i', container, 'pg_restore', *forwarded], stdin=incoming)
    else:
        raise RuntimeError(f'Unexpected PostgreSQL binary {binary}')
    return result.returncode


if __name__ == '__main__':
    sys.exit(main())
