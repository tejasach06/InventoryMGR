import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { vms as vmsApi } from '../api/vms';
import { clusters as clustersApi } from '../api/clusters';
import { dashboard as dashboardApi } from '../api/dashboard';
import { imports as importsApi } from '../api/imports';
import { settings as settingsApi } from '../api/settings';
import { auth as authApi } from '../api/auth';
import { ApiError, apiRequest, detailMessage } from '../api/core';
import type { VmPayload } from '../api/types';

interface FakeResponseInit {
  status: number;
  body?: string;
}

let fetchMock: Mock;

function fakeResponse({ status, body = '' }: FakeResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function lastFetchCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return call as [string, RequestInit];
}

function headerValue(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

beforeEach(() => {
  // jsdom keeps cookies between tests; clear the CSRF cookie explicitly.
  document.cookie = 'inventorymgr_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiRequest', () => {
  it('issues a GET without a body, Content-Type, or CSRF header and includes credentials', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{"ok":true}' }));

    const result = await apiRequest<{ ok: boolean }>('/auth/me');

    expect(result).toEqual({ ok: true });
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(headerValue(init, 'Content-Type')).toBeNull();
    expect(headerValue(init, 'X-CSRF-Token')).toBeNull();
  });

  it('adds a JSON Content-Type for a string body on a state-changing method', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));

    await apiRequest('/vms', { method: 'post', body: JSON.stringify({ name: 'x' }) });

    const [, init] = lastFetchCall();
    expect(init.method).toBe('POST');
    expect(headerValue(init, 'Content-Type')).toBe('application/json');
  });

  it('attaches the X-CSRF-Token header from the cookie on state-changing requests', async () => {
    document.cookie = 'inventorymgr_csrf=tok-123';
    fetchMock.mockResolvedValue(fakeResponse({ status: 204 }));

    await apiRequest('/vms/1', { method: 'DELETE' });

    const [, init] = lastFetchCall();
    expect(headerValue(init, 'X-CSRF-Token')).toBe('tok-123');
  });

  it('omits the CSRF header when no cookie is present', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));

    await apiRequest('/vms', { method: 'POST', body: '{}' });

    const [, init] = lastFetchCall();
    expect(headerValue(init, 'X-CSRF-Token')).toBeNull();
  });

  it('does not set Content-Type for a FormData body', async () => {
    document.cookie = 'inventorymgr_csrf=tok';
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const body = new FormData();
    body.set('file', new File(['a,b'], 'in.csv', { type: 'text/csv' }));

    await apiRequest('/imports/preview', { method: 'POST', body });

    const [, init] = lastFetchCall();
    expect(headerValue(init, 'Content-Type')).toBeNull();
  });

  it('respects a caller-provided Content-Type header', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));

    await apiRequest('/vms', { method: 'POST', body: 'raw', headers: { 'Content-Type': 'text/plain' } });

    const [, init] = lastFetchCall();
    expect(headerValue(init, 'Content-Type')).toBe('text/plain');
  });

  it('returns null for a 204 response', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 204 }));
    expect(await apiRequest('/auth/logout', { method: 'POST' })).toBeNull();
  });

  it('returns null for an empty 200 body', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '' }));
    expect(await apiRequest('/auth/me')).toBeNull();
  });

  it('returns the raw text when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'plain text' }));
    expect(await apiRequest('/auth/me')).toBe('plain text');
  });

  it('throws ApiError with the extracted detail field on an error response', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 409, body: '{"detail":"VM identity already exists"}' }));

    await expect(apiRequest('/vms', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      detail: 'VM identity already exists',
    });
  });

  it('uses the whole payload as detail when there is no detail field', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, body: '"boom"' }));

    await expect(apiRequest('/vms')).rejects.toMatchObject({ status: 500, detail: 'boom' });
  });
});

describe('ApiError', () => {
  it('uses a string detail as the message', () => {
    expect(new ApiError(400, 'bad input').message).toBe('bad input');
  });

  it('falls back to a status message for non-string detail', () => {
    expect(new ApiError(500, { detail: 'x' }).message).toBe('Request failed with status 500');
  });
});

describe('detailMessage', () => {
  it('returns the string detail of an ApiError', () => {
    expect(detailMessage(new ApiError(400, 'nope'))).toBe('nope');
  });

  it('joins an array of FastAPI field errors by their msg', () => {
    const error = new ApiError(422, [{ msg: 'field a invalid' }, { msg: 'field b invalid' }]);
    expect(detailMessage(error)).toBe('field a invalid; field b invalid');
  });

  it('joins an array of plain string details', () => {
    expect(detailMessage(new ApiError(422, ['x', 'y']))).toBe('x; y');
  });

  it('falls back for array items without a msg field', () => {
    expect(detailMessage(new ApiError(422, [{ loc: ['body'] }]))).toBe('Request validation failed');
  });

  it('returns the message of a generic Error', () => {
    expect(detailMessage(new Error('network down'))).toBe('network down');
  });

  it('returns a default message for non-Error values', () => {
    expect(detailMessage('weird')).toBe('Unexpected error');
  });
});

describe('api client methods', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
  });

  it('builds the expected request for each endpoint helper', async () => {
    const cases: Array<{ run: () => Promise<unknown>; url: string; method: string }> = [
      { run: () => authApi.setupStatus(), url: '/api/auth/setup', method: 'GET' },
      { run: () => authApi.setupAdmin('a@b.c', 'pw'), url: '/api/auth/setup', method: 'POST' },
      { run: () => authApi.login('a@b.c', 'pw'), url: '/api/auth/login', method: 'POST' },
      { run: () => authApi.logout(), url: '/api/auth/logout', method: 'POST' },
      { run: () => authApi.me(), url: '/api/auth/me', method: 'GET' },
      { run: () => authApi.listUsers(), url: '/api/users', method: 'GET' },
      { run: () => authApi.createUser({ email: 'a@b.c', password: 'pw', role: 'viewer', is_active: true }), url: '/api/users', method: 'POST' },
      { run: () => authApi.updateUser('u1', { role: 'admin' }), url: '/api/users/u1', method: 'PATCH' },
      { run: () => vmsApi.getVm('v1'), url: '/api/vms/v1', method: 'GET' },
      { run: () => vmsApi.deleteVm('v1'), url: '/api/vms/v1', method: 'DELETE' },
      { run: () => importsApi.getImport('i1'), url: '/api/imports/i1', method: 'GET' },
      { run: () => importsApi.commitImport('i1'), url: '/api/imports/i1/commit', method: 'POST' },
      { run: () => vmsApi.listVmOwners(), url: '/api/vms/owners', method: 'GET' },
      { run: () => settingsApi.getDropdownOptions(), url: '/api/settings/options', method: 'GET' },
      { run: () => settingsApi.getAllDropdownOptions(), url: '/api/settings/options/all', method: 'GET' },
      { run: () => settingsApi.createDropdownOption('cpu', '8'), url: '/api/settings/options', method: 'POST' },
      { run: () => settingsApi.updateDropdownOption('o1', '16'), url: '/api/settings/options/o1', method: 'PATCH' },
      { run: () => settingsApi.deleteDropdownOption('o1'), url: '/api/settings/options/o1', method: 'DELETE' },
      { run: () => settingsApi.getColumnPreferences('inventory'), url: '/api/user/preferences/inventory', method: 'GET' },
      { run: () => settingsApi.updateColumnPreferences('inventory', [{ key: 'name', visible: true, order: 0 }]), url: '/api/user/preferences/inventory', method: 'PUT' },
      { run: () => settingsApi.getAccent(), url: '/api/user/accent', method: 'GET' },
      { run: () => settingsApi.setAccent('blue'), url: '/api/user/accent', method: 'PUT' },
      { run: () => settingsApi.getAppSettings(), url: '/api/settings/app', method: 'GET' },
      { run: () => settingsApi.updateAppSettings({ decommission_notify_days: 30 }), url: '/api/settings/app', method: 'PATCH' },
      { run: () => settingsApi.getLdapConfig(), url: '/api/settings/ldap', method: 'GET' },
      { run: () => settingsApi.updateLdapConfig({ enabled: true, server_uri: 'ldap://example', start_tls: false, verify_tls: true, bind_dn: null, user_base_dn: 'dc=example', user_filter: '(uid={username})', email_attribute: 'mail', group_attribute: 'memberOf', admin_group_dn: null, editor_group_dn: null, viewer_group_dn: null, default_role: 'viewer' }), url: '/api/settings/ldap', method: 'PUT' },
      { run: () => settingsApi.testLdapConnection({ username: 'u', password: 'p' }), url: '/api/settings/ldap/test', method: 'POST' },
      { run: () => clustersApi.listClusters(), url: '/api/clusters', method: 'GET' },
      { run: () => clustersApi.getCluster('c1'), url: '/api/clusters/c1', method: 'GET' },
      { run: () => clustersApi.createCluster({ name: 'c1', description: 'cluster' }), url: '/api/clusters', method: 'POST' },
      { run: () => clustersApi.updateCluster('c1', { name: 'c2' }), url: '/api/clusters/c1', method: 'PATCH' },
      { run: () => clustersApi.deleteCluster('c1'), url: '/api/clusters/c1', method: 'DELETE' },
      { run: () => clustersApi.addNode('c1', { name: 'n1' }), url: '/api/clusters/c1/nodes', method: 'POST' },
      { run: () => clustersApi.updateNode('c1', 'n1', { name: 'n2' }), url: '/api/clusters/c1/nodes/n1', method: 'PATCH' },
      { run: () => clustersApi.deleteNode('c1', 'n1'), url: '/api/clusters/c1/nodes/n1', method: 'DELETE' },
      { run: () => dashboardApi.getDashboard(), url: '/api/dashboard', method: 'GET' },
      { run: () => dashboardApi.getReportSummary(), url: '/api/reports/summary', method: 'GET' },
      { run: () => vmsApi.cloneVm('v1'), url: '/api/vms/v1/clone', method: 'POST' },
      { run: () => vmsApi.bulkUpdateVms({ ids: ['v1'], patch: { environment: 'production' } }), url: '/api/vms/bulk', method: 'POST' },
      { run: () => vmsApi.listVmClusters(), url: '/api/vms/clusters', method: 'GET' },
      { run: () => vmsApi.listVmNodes(), url: '/api/vms/nodes', method: 'GET' },
      { run: () => vmsApi.listVmApplications(), url: '/api/vms/applications', method: 'GET' },
      { run: () => vmsApi.listVmTags(), url: '/api/vms/tags', method: 'GET' },
      { run: () => vmsApi.listDisks('v1'), url: '/api/vms/v1/disks', method: 'GET' },
      { run: () => vmsApi.addDisk('v1', { disk_name: 'disk1', size_gb: 10, storage_name: null, storage_type: null, sort_order: 0 }), url: '/api/vms/v1/disks', method: 'POST' },
      { run: () => vmsApi.deleteDisk('v1', 'd1'), url: '/api/vms/v1/disks/d1', method: 'DELETE' },
      { run: () => vmsApi.listNetworks('v1'), url: '/api/vms/v1/networks', method: 'GET' },
      { run: () => vmsApi.addNetwork('v1', { ip_address: '10.0.0.1', role: 'private', sort_order: 0 }), url: '/api/vms/v1/networks', method: 'POST' },
      { run: () => vmsApi.deleteNetwork('v1', 'n1'), url: '/api/vms/v1/networks/n1', method: 'DELETE' },
      { run: () => vmsApi.listApplications('v1'), url: '/api/vms/v1/applications', method: 'GET' },
      { run: () => vmsApi.addApplication('v1', { app_name: 'app', app_owner: null, description: null }), url: '/api/vms/v1/applications', method: 'POST' },
      { run: () => vmsApi.deleteApplication('v1', 'a1'), url: '/api/vms/v1/applications/a1', method: 'DELETE' },
      { run: () => vmsApi.getAuditLog('v1'), url: '/api/vms/v1/audit?limit=50', method: 'GET' },
      { run: () => vmsApi.decommissionNotifications(), url: '/api/notifications/decommissions', method: 'GET' },
    ];

    for (const tc of cases) {
      await tc.run();
      const [url, init] = lastFetchCall();
      expect(url).toBe(tc.url);
      expect((init.method ?? 'GET').toUpperCase()).toBe(tc.method);
    }
  });

  it('serializes list params and preview file uploads', async () => {
    await vmsApi.listVms(new URLSearchParams({ limit: '50', q: 'web' }));
    expect(lastFetchCall()[0]).toBe('/api/vms?limit=50&q=web');

    const payload: VmPayload = {
      name: 'x',
      fqdn: null,
      description: null,
      platform: 'proxmox',
      datacenter: null,
      cluster: 'c1',
      node: null,
      external_id: null,
      sr_id: null,
      status: 'running',
      environment: 'production',
      cpu_cores: 2,
      memory_mb: 2048,
      os_family: null,
      os_distribution: null,
      os_version: null,
      owner: null,
      business_owner: null,
      pmp_enabled: false,
      monitoring_enabled: false,
      backup_enabled: false,
      backup_location: null,
      ha_enabled: false,
      criticality: 'low',
      tags: [],
      last_patch_date: null,
      last_vuln_scan_date: null,
      security_remarks: null,
      decommission_date: null,
      last_verified_at: null,
        vm_type: 'permanent',
      technical_owner: null,
      disks: [],
      networks: [],
    };
    await vmsApi.createVm(payload);
    expect(lastFetchCall()[0]).toBe('/api/vms');

    await vmsApi.updateVm('v1', { name: 'y' });
    expect(lastFetchCall()).toEqual(['/api/vms/v1', expect.objectContaining({ method: 'PATCH' })]);

    await importsApi.previewImport(new File(['a'], 'in.csv', { type: 'text/csv' }));
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/imports/preview');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('ackDecommissions posts null vm_ids when omitted', async () => {
    await vmsApi.ackDecommissions();
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/notifications/decommissions/ack');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ vm_ids: null }));
  });
  it('builds export URLs for csv and xlsx formats', () => {
    expect(vmsApi.exportVmsUrl(new URLSearchParams({ q: 'test' }))).toBe('/api/vms/export?q=test');
    expect(vmsApi.exportVmsUrl(new URLSearchParams({ q: 'test' }), 'xlsx')).toBe('/api/vms/export?q=test&format=xlsx');
    expect(vmsApi.exportSelectedUrl(['id1', 'id2'])).toBe('/api/vms/export?ids=id1&ids=id2');
    expect(vmsApi.exportSelectedUrl(['id1', 'id2'], 'xlsx')).toBe('/api/vms/export?ids=id1&ids=id2&format=xlsx');
    expect(vmsApi.exportVmsUrl()).toBe('/api/vms/export');
    expect(dashboardApi.reportUrl('linux')).toBe('/api/reports/linux?format=csv');
  });
});
