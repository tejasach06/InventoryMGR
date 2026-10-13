#!/usr/bin/env python3
"""Run real HTTP contracts against disposable PostgreSQL databases, never supplied URLs."""
import argparse
import csv
import difflib
import hashlib
import http.cookiejar
from http.cookies import SimpleCookie
import io
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / 'backend/openapi_baseline.json').read_text())
PASSWORD = 'parity-only-correct-horse-battery'
ZERO = '00000000-0000-0000-0000-000000000001'
VOLATILE = {'created_at', 'updated_at', 'started_at', 'finished_at', 'last_login_at', 'expires_at', 'changed_at'}


def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Client:
    def __init__(self, port):
        self.base = f'http://127.0.0.1:{port}'
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.records = []
        self.ids = {}
        self.covered = set()

    def normalize(self, value, key=''):
        if isinstance(value, dict):
            if 'size_bytes' in value and value.get('kind') in ('manual', 'restore', 'pre_restore'):
                value = dict(value, size_bytes='<nonempty-dump>' if (value['size_bytes'] or 0) > 0 else value['size_bytes'])
            return {k: self.normalize(v, k) for k, v in sorted(value.items())}
        if isinstance(value, list):
            return [self.normalize(v, key) for v in value]
        if isinstance(value, str):
            if re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', value):
                return self.ids.setdefault(value, f'<uuid:{len(self.ids)}>')
            if key in VOLATILE:
                return '<timestamp>'
            if key == 'filename' and re.fullmatch(r'tmp[^/]+\.dump', value):
                return '<restore-upload>.dump'
            if re.fullmatch(r'inventorymgr-\d{8}T\d{6}Z-.*\.dump', value):
                return re.sub(r'-[0-9a-f]{32}(?=\.dump$)', '', re.sub(r'\d{8}T\d{6}Z', '<timestamp>', value))
        return value

    def request(self, method, path, payload=None, *, csrf=True, upload=None, label=None):
        headers = {}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        if upload is not None:
            filename, content, mime, fields = upload
            boundary = 'inventorymgr-parity-boundary'
            parts = []
            for name, value in fields.items():
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + content + b'\r\n')
            data = b''.join(parts) + f'--{boundary}--\r\n'.encode()
            headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
        if csrf and method not in ('GET', 'HEAD', 'OPTIONS'):
            for cookie in self.cookies:
                if cookie.name == 'inventorymgr_csrf':
                    headers['X-CSRF-Token'] = cookie.value
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=45)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        content_type = response.headers.get('Content-Type', '').split(';')[0]
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            if 'spreadsheetml' in content_type:
                ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    shared = []
                    if 'xl/sharedStrings.xml' in archive.namelist():
                        shared = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
                    sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
                    rows = []
                    for row in sheet.findall('s:sheetData/s:row', ns):
                        cells = {}
                        for cell in row:
                            value = cell.find('s:v', ns)
                            text = ''.join(cell.find('s:is', ns).itertext()) if cell.find('s:is', ns) is not None else (value.text if value is not None else '')
                            if cell.get('t') == 's':
                                text = shared[int(text)]
                            column = re.sub(r'\d+', '', cell.get('r'))
                            cells[column] = text
                        rows.append(cells)
                    if rows:
                        for row in rows[1:]:
                            for column, header in rows[0].items():
                                if header in VOLATILE and row.get(column):
                                    row[column] = '<timestamp>'
                    body = {'rows': rows}
            elif content_type == 'text/csv':
                body = list(csv.reader(io.StringIO(raw.decode())))
                if body:
                    for row in body[1:]:
                        for index, header in enumerate(body[0]):
                            if header in VOLATILE and index < len(row) and row[index]:
                                row[index] = '<timestamp>'
            elif content_type in ('application/octet-stream', 'application/x-postgresql-dump'):
                body = {'nonempty': bool(raw), 'postgres_dump': raw.startswith(b'PGDMP')}
            else:
                body = raw.decode('utf-8', errors='replace')
                for actual, alias in self.ids.items():
                    body = body.replace(actual, alias)
        cookies = {}
        for header in response.headers.get_all('Set-Cookie', []):
            parsed = SimpleCookie()
            parsed.load(header)
            for name, morsel in parsed.items():
                cookies[name] = {k: ('<timestamp>' if k == 'expires' else str(v).lower() if k == 'samesite' else v) for k, v in morsel.items() if v}

        record = {'case': label or f'{method} {path}', 'status': response.status, 'content_type': content_type,
                  'body': self.normalize(body), 'cookies': cookies,
                  'headers': {k.lower(): response.headers[k] for k in ('X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy') if k in response.headers}}
        for actual, alias in self.ids.items():
            record['case'] = record['case'].replace(actual, alias)
        record['case'] = re.sub(r'-[0-9a-f]{32}(?=\.dump)', '', re.sub(r'\d{8}T\d{6}Z', '<timestamp>', record['case']))
        self.records.append(record)
        for template, operations in SPEC['paths'].items():
            if method.lower() in operations and re.fullmatch(re.sub(r'\{[^}]+\}', '[^/]+', template), path.split('?')[0]):
                self.covered.add((method.lower(), template))
        return response.status, body, raw

    def must(self, method, path, payload=None, **kwargs):
        status, body, _ = self.request(method, path, payload, **kwargs)
        if not 200 <= status < 300:
            error = RuntimeError(f'{method} {path}: expected success, got {status}: {body}')
            error.records = self.records
            raise error
        return body


def suite(port):
    c = Client(port)
    c.must('GET', '/api/health')
    c.must('GET', '/api/auth/setup')
    c.request('POST', '/api/auth/setup', {})
    c.request('POST', '/api/auth/setup', {'email': 'bad@parity.test', 'password': 'short'})
    c.request('POST', '/api/auth/login', {})
    c.request('POST', '/api/auth/refresh')
    for path, methods in SPEC['paths'].items():
        for method in methods:
            if method not in ('get', 'post', 'put', 'patch', 'delete') or path.startswith('/api/auth/'):
                continue
            concrete = re.sub(r'\{[^}]+\}', ZERO, path)
            c.request(method.upper(), concrete, {} if method != 'get' else None, label=f'unauthenticated {method} {path}')
    c.must('POST', '/api/auth/setup', {'email': 'admin@parity.test', 'password': PASSWORD})
    c.request('POST', '/api/auth/setup', {'email': 'other@parity.test', 'password': PASSWORD})
    c.must('GET', '/api/auth/me')
    c.request('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': 'wrong'})
    users = {}
    for role in ('editor', 'viewer'):
        users[role] = c.must('POST', '/api/users', {'email': f'{role}@parity.test', 'password': PASSWORD, 'role': role})['id']
    c.must('GET', '/api/users')
    c.request('POST', '/api/users', {})
    c.request('POST', '/api/users', {'email': 'bad@parity.test', 'password': PASSWORD, 'role': 'unknown'})
    c.request('PATCH', '/api/settings/app', {'decommission_notify_days': 0})
    c.request('PUT', '/api/settings/ldap', {})
    c.must('PATCH', '/api/users/' + users['editor'], {'is_active': True})
    c.must('PUT', '/api/user/accent', {'accent': 'blue'})
    c.request('PUT', '/api/user/accent', {'accent': 'invalid'})
    c.request('PUT', '/api/user/accent', {'accent': 'orange'}, csrf=False)
    c.must('PUT', '/api/user/preferences/inventory', {'columns': [{'key': 'ip_address', 'visible': True, 'order': 0}]})
    c.must('GET', '/api/user/preferences/inventory')
    c.must('GET', '/api/user/accent')
    c.must('PATCH', '/api/settings/app', {'decommission_notify_days': 42, 'storage_usage_warn_pct': 75})
    c.must('PUT', '/api/settings/ldap', {'enabled': False, 'server_uri': 'ldap://127.0.0.1:1', 'user_base_dn': 'dc=parity,dc=test'})
    c.request('POST', '/api/settings/ldap/test')
    for path in ('/api/settings/app', '/api/settings/options', '/api/settings/ldap'):
        c.must('GET', path)
    vm = {'name': 'parity-vm-2', 'platform': 'proxmox', 'cluster': 'parity-cluster', 'status': 'running', 'cpu_cores': 4, 'memory_mb': 8192, 'criticality': 'high', 'os_family': 'linux', 'owner': 'ops', 'tags': ['parity'], 'disks': [{'disk_name': 'boot', 'size_gb': 32}], 'networks': [{'ip_address': '192.0.2.10/24', 'role': 'private'}]}
    ident = c.must('POST', '/api/vms', vm)['id']
    vp = '/api/vms/' + ident
    c.must('GET', vp)
    c.must('PATCH', vp, {'owner': 'new-owner', 'monitoring_enabled': True})
    c.request('POST', '/api/vms', {'name': '', 'cpu_cores': -1})
    c.request('PATCH', vp, {'status': 'not-a-status'})
    c.request('GET', '/api/vms/not-a-uuid')
    clone = c.must('POST', vp + '/clone')['id']
    for kind, payload, patch in (
        ('disks', {'disk_name': 'data', 'size_gb': 64}, {'size_gb': 128}),
        ('networks', {'ip_address': '192.0.2.11', 'role': 'public'}, {'role': 'backup'}),
        ('applications', {'app_name': 'parity-app', 'app_owner': 'ops'}, {'description': 'updated'}),
    ):
        child = c.must('POST', vp + '/' + kind, payload)['id']
        c.must('GET', vp + '/' + kind)
        c.must('PATCH', vp + '/' + kind + '/' + child, patch)
        c.must('DELETE', vp + '/' + kind + '/' + child)
    c.must('POST', '/api/vms/bulk', {'ids': [ident, ZERO], 'patch': {'tags_add': ['bulk'], 'tags_remove': ['parity']}})
    c.must('POST', '/api/vms/bulk', {'filters': {'cluster': ['parity-cluster']}, 'patch': {'owner': 'bulk-owner'}})
    c.request('POST', '/api/vms/bulk', {'patch': {'name': 'forbidden'}})
    for query in ('', '?limit=1&offset=1&sort=name&dir=desc', '?status=running&status=stopped', '?q=bulk-owner', '?cluster=parity-cluster', '?missing_ip=true', '?platform=invalid', '?limit=-1'):
        c.request('GET', '/api/vms' + query)
    for endpoint in ('clusters', 'nodes', 'owners', 'tags', 'applications', 'suggestions'):
        c.request('GET', '/api/vms/' + endpoint)
    c.must('GET', vp + '/audit?limit=50')
    for fmt in ('csv', 'xlsx'):
        c.must('GET', '/api/vms/export?format=' + fmt)
    cluster = c.must('POST', '/api/clusters', {'name': 'physical-parity'})['id']
    cp = '/api/clusters/' + cluster
    c.must('GET', '/api/clusters')
    c.must('GET', cp)
    c.must('PATCH', cp, {'description': 'updated'})
    node = c.must('POST', cp + '/nodes', {'name': 'node-1', 'cpu_cores': 8, 'ram_total_gb': 64})['id']
    c.must('GET', cp + '/nodes')
    c.must('PATCH', cp + '/nodes/' + node, {'cpu_cores': 16})
    c.must('DELETE', cp + '/nodes/' + node)
    array = c.must('POST', '/api/storage/arrays', {'name': 'parity-array', 'vendor': 'netapp', 'total_capacity_gb': 1000, 'used_capacity_gb': 800})['id']
    ap = '/api/storage/arrays/' + array
    c.must('GET', '/api/storage/arrays')
    c.must('GET', ap)
    c.must('PATCH', ap, {'description': 'updated'})
    volume = c.must('POST', ap + '/volumes', {'name': 'parity-vol', 'size_gb': 500})['id']
    c.must('GET', ap + '/volumes')
    c.must('PATCH', ap + '/volumes/' + volume, {'name': 'renamed-vol'})
    for kind, payload, patch in (('luns', {'name': 'lun-1', 'size_gb': 50}, {'size_gb': 60}), ('shares', {'export_path': '/parity'}, {'notes': 'updated'})):
        sp = '/api/storage/volumes/' + volume + '/' + kind
        child = c.must('POST', sp, payload)['id']
        c.must('GET', sp)
        c.must('PATCH', sp + '/' + child, patch)
        c.must('DELETE', sp + '/' + child)
    dash_pre = c.must('GET', '/api/dashboard')
    tmpl_id = c.must('POST', '/api/vms', {**vm, 'name': 'tmpl-excluded', 'tags': ['Template'], 'networks': [], 'decommission_date': '2000-01-01'})['id']
    bkp_id = c.must('POST', '/api/vms', {**vm, 'name': 'backup-excluded', 'tags': ['BACKUP'], 'networks': [], 'decommission_date': '2000-01-01'})['id']
    dash_post = c.must('GET', '/api/dashboard')
    if dash_post['total'] != dash_pre['total']:
        raise AssertionError(f"Expected dashboard total {dash_pre['total']} (excluded template/backup tags), got {dash_post['total']}")
    excluded = c.must('GET', '/api/vms?q=excluded&missing_ip=true')
    assert excluded['items'] == [], f"Excluded VMs leaked into missing-IP alerts: {excluded['items']}"
    ordinary = c.must('GET', '/api/vms?q=excluded')
    assert ordinary['total'] == 2, f"Ordinary inventory lost tagged VMs: {ordinary}"
    due = c.must('GET', '/api/notifications/decommissions')
    assert {tmpl_id, bkp_id}.isdisjoint({row['vm_id'] for row in due}), f"Excluded VMs leaked into notifications: {due}"
    c.must('DELETE', '/api/vms/' + tmpl_id)
    c.must('DELETE', '/api/vms/' + bkp_id)
    summary = c.must('GET', '/api/reports/summary')
    for name in ('linux', 'windows', 'missing'):
        c.request('GET', '/api/reports/' + name + '?format=csv')
    for path in ('/api/notifications/decommissions', '/api/notifications/duplicate-ips'):
        c.must('GET', path)
    c.must('POST', '/api/notifications/decommissions/ack', {'vm_ids': [ident]})
    c.must('GET', '/api/imports/template')
    content = b'name,platform,cluster,status,cpu_cores,memory_mb,criticality\nimported-parity,proxmox,parity-cluster,running,2,2048,low\n'
    batch = c.must('POST', '/api/imports/preview', upload=('parity.csv', content, 'text/csv', {}))['id']
    c.must('GET', '/api/imports/' + batch)
    c.must('POST', '/api/imports/' + batch + '/commit', {})
    c.request('POST', '/api/imports/' + batch + '/commit', {})
    c.request('POST', '/api/imports/preview', upload=('wrong.txt', b'bad', 'text/plain', {}))
    c.must('GET', '/api/backups')
    c.must('PATCH', '/api/backups/settings', {'enabled': False, 'hour_utc': 3, 'retention': 2})
    c.request('GET', '/api/backups/missing.dump/download')

    c.request('DELETE', '/api/backups/missing.dump')
    c.request('POST', '/api/backups/restore', upload=('bad.dump', b'not-a-dump', 'application/octet-stream', {'confirm': 'WRONG'}))
    backup = c.must('POST', '/api/backups')
    filename = backup['filename']
    status, _, dump = c.request('GET', '/api/backups/' + filename + '/download')
    if status != 200 or not dump.startswith(b'PGDMP'):
        raise RuntimeError('Backup download is not a real PostgreSQL custom dump')
    c.must('DELETE', '/api/backups/' + filename)
    for role in ('viewer', 'editor'):
        c.cookies.clear()
        c.must('POST', '/api/auth/login', {'email': f'{role}@parity.test', 'password': PASSWORD, 'remember': role == 'editor'})
        c.must('POST', '/api/auth/refresh')
        for path in ('/api/users', '/api/settings/ldap', '/api/backups', '/api/vms', '/api/clusters', '/api/storage/arrays'):
            c.request('GET', path)
        c.request('PATCH', vp, {'description': role})
        c.request('PATCH', vp, {'description': role}, csrf=False)
        c.request('DELETE', vp)
        c.must('PUT', '/api/user/accent', {'accent': 'violet'})
        c.must('POST', '/api/auth/logout')
        c.request('GET', '/api/auth/me')
    c.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
    c.must('DELETE', ap + '/volumes/' + volume)
    c.must('DELETE', ap)
    c.must('DELETE', cp)
    c.must('DELETE', '/api/vms/' + clone)
    c.must('DELETE', vp)
    c.must('DELETE', '/api/users/' + users['viewer'])
    c.must('POST', '/api/backups/restore', upload=('parity.dump', dump, 'application/octet-stream', {'confirm': 'RESTORE'}))
    c.request('GET', '/api/auth/me')
    c.request('POST', '/api/auth/refresh')
    c.must('POST', '/api/auth/login', {'email': 'admin@parity.test', 'password': PASSWORD})
    c.must('GET', '/api/vms')
    operations = {(m, p) for p, methods in SPEC['paths'].items() for m in methods if m in ('get', 'post', 'put', 'patch', 'delete')}
    missing = operations - c.covered
    if missing:
        raise RuntimeError(f'Frozen operations not exercised: {sorted(missing)}')
    return c.records


def wait_ready(process, port):
    for _ in range(200):
        if process.poll() is not None:
            raise RuntimeError(f'Backend exited early with {process.returncode}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    raise RuntimeError('Backend readiness timed out')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rust-binary', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--postgres-image', default='docker.io/library/postgres:17')
    parser.add_argument('--scratch-dir', type=Path, default=ROOT / '.parity-scratch')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.scratch_dir.mkdir(parents=True, exist_ok=True)
    python = ROOT / 'backend/.venv/bin/python'
    container = 'inventorymgr-rust-parity-' + secrets.token_hex(6)
    processes = []
    with tempfile.TemporaryDirectory(prefix='inventorymgr-rust-parity-', dir=args.scratch_dir) as temporary:
        scratch = Path(temporary)
        try:
            command('podman', 'run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', args.postgres_image)
            port = int(command('podman', 'port', container, '5432/tcp').rsplit(':', 1)[1])
            for _ in range(100):
                ready = subprocess.run(['podman', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
                if ready.returncode == 0:
                    break
                time.sleep(.2)
            else:
                raise RuntimeError('Disposable PostgreSQL readiness timed out')
            records = {}
            for implementation in ('python', 'rust') if args.rust_binary else ('python',):
                database = 'parity_' + implementation
                command('podman', 'exec', container, 'createdb', '-U', 'postgres', database)
                url = f'postgresql://postgres@127.0.0.1:{port}/{database}'
                http_port = free_port()
                backups = scratch / implementation / 'backups'
                backups.mkdir(parents=True)
                pg_bin = scratch / implementation / 'pg-bin'
                pg_bin.mkdir()
                bridge = (ROOT / 'tools/rust-parity/pg_bridge.py').read_text()
                for name in ('pg_dump', 'pg_restore'):
                    wrapper = pg_bin / name
                    wrapper.write_text(bridge)
                    wrapper.chmod(0o700)
                env = dict(os.environ, APP_ENV='test', DATABASE_URL=url if implementation == 'rust' else url.replace('postgresql://', 'postgresql+psycopg://'), JWT_SECRET=secrets.token_hex(32), BACKUP_DIR=str(backups), HOST='127.0.0.1', PORT=str(http_port), BIND_ADDR=f'127.0.0.1:{http_port}')
                env.update(PG_BIN_DIR=str(pg_bin), PARITY_PG_CONTAINER=container, PARITY_PG_URL=f'postgresql://postgres@127.0.0.1:5432/{database}')
                if implementation == 'python':
                    command(str(python), '-m', 'alembic', 'upgrade', 'head', cwd=ROOT / 'backend', env=env)
                    invocation = [str(python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(http_port)]
                else:
                    invocation = [str(args.rust_binary.resolve())]
                log_path = args.output / (implementation + '.log')
                with log_path.open('w') as log:
                    process = subprocess.Popen(invocation, cwd=ROOT / 'backend', env=env, stdout=log, stderr=subprocess.STDOUT)
                    processes.append(process)
                    wait_ready(process, http_port)
                    try:
                        records[implementation] = suite(http_port)
                    except RuntimeError as error:
                        if hasattr(error, 'records'):
                            (args.output / (implementation + '.partial.json')).write_text(json.dumps(error.records, indent=2) + '\n')
                        raise
                    process.terminate()
                    process.wait(timeout=20)
                (args.output / (implementation + '.json')).write_text(json.dumps(records[implementation], indent=2) + '\n')
            metadata = {'openapi_sha256': hashlib.sha256((ROOT / 'backend/openapi_baseline.json').read_bytes()).hexdigest(), 'python_cases': len(records['python']), 'frozen_operations': sum(m in ('get', 'post', 'put', 'patch', 'delete') for methods in SPEC['paths'].values() for m in methods), 'isolated_database': True}
            (args.output / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
            if 'rust' in records:
                left = json.dumps(records['python'], indent=2).splitlines(True)
                right = json.dumps(records['rust'], indent=2).splitlines(True)
                difference = ''.join(difflib.unified_diff(left, right, fromfile='python', tofile='rust'))
                (args.output / 'parity.diff').write_text(difference)
                if difference:
                    print(f'HTTP parity mismatch: {args.output / "parity.diff"}', file=sys.stderr)
                    return 1
            print(json.dumps(metadata))
            return 0
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
    sys.exit(main())

