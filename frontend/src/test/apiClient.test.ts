import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, apiRequest, detailMessage, api, type VmPayload } from '../api/client';

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
      { run: () => api.setupStatus(), url: '/api/auth/setup', method: 'GET' },
      { run: () => api.setupAdmin('a@b.c', 'pw'), url: '/api/auth/setup', method: 'POST' },
      { run: () => api.login('a@b.c', 'pw'), url: '/api/auth/login', method: 'POST' },
      { run: () => api.logout(), url: '/api/auth/logout', method: 'POST' },
      { run: () => api.me(), url: '/api/auth/me', method: 'GET' },
      { run: () => api.listUsers(), url: '/api/users', method: 'GET' },
      { run: () => api.createUser({ email: 'a@b.c', password: 'pw', role: 'viewer', is_active: true }), url: '/api/users', method: 'POST' },
      { run: () => api.updateUser('u1', { role: 'admin' }), url: '/api/users/u1', method: 'PATCH' },
      { run: () => api.getVm('v1'), url: '/api/vms/v1', method: 'GET' },
      { run: () => api.deleteVm('v1'), url: '/api/vms/v1', method: 'DELETE' },
      { run: () => api.getImport('i1'), url: '/api/imports/i1', method: 'GET' },
      { run: () => api.commitImport('i1'), url: '/api/imports/i1/commit', method: 'POST' },
      { run: () => api.listVmOwners(), url: '/api/vms/owners', method: 'GET' },
      { run: () => api.getDropdownOptions(), url: '/api/settings/options', method: 'GET' },
      { run: () => api.getAllDropdownOptions(), url: '/api/settings/options/all', method: 'GET' },
      { run: () => api.createDropdownOption('cpu', '8'), url: '/api/settings/options', method: 'POST' },
      { run: () => api.updateDropdownOption('o1', '16'), url: '/api/settings/options/o1', method: 'PATCH' },
      { run: () => api.deleteDropdownOption('o1'), url: '/api/settings/options/o1', method: 'DELETE' },
    ];

    for (const tc of cases) {
      await tc.run();
      const [url, init] = lastFetchCall();
      expect(url).toBe(tc.url);
      expect((init.method ?? 'GET').toUpperCase()).toBe(tc.method);
    }
  });

  it('serializes list params and preview file uploads', async () => {
    await api.listVms(new URLSearchParams({ limit: '50', q: 'web' }));
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
      lifecycle: 'active',
      vm_type: 'permanent',
      os_name: null,
      technical_owner: null,
      disks: [],
      networks: [],
    };
    await api.createVm(payload);
    expect(lastFetchCall()[0]).toBe('/api/vms');

    await api.updateVm('v1', { name: 'y' });
    expect(lastFetchCall()).toEqual(['/api/vms/v1', expect.objectContaining({ method: 'PATCH' })]);

    await api.previewImport(new File(['a'], 'in.csv', { type: 'text/csv' }));
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/imports/preview');
    expect(init.body).toBeInstanceOf(FormData);
  });
});
