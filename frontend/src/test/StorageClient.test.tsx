import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';

function mockFetch(status = 200, body: unknown = {}) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  };
  const spy = vi.fn().mockResolvedValue(res as unknown as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function lastCall(spy: ReturnType<typeof vi.fn>) {
  const [url, init] = spy.mock.calls[spy.mock.calls.length - 1];
  return { url: String(url), method: (init?.method ?? 'GET') as string };
}

beforeEach(() => {
  document.cookie = 'inventorymgr_csrf=tok';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('storage api client methods', () => {
  it('routes each storage call to the right method + path', async () => {
    let spy = mockFetch(200, []);
    await api.listArrays();
    expect(lastCall(spy)).toEqual({ url: '/api/storage/arrays', method: 'GET' });

    spy = mockFetch(200, { id: 'a1' });
    await api.getArray('a1');
    expect(lastCall(spy).url).toBe('/api/storage/arrays/a1');

    spy = mockFetch(201, { id: 'a1' });
    await api.createArray({ name: 'syn', vendor: 'synology' });
    expect(lastCall(spy)).toEqual({ url: '/api/storage/arrays', method: 'POST' });

    spy = mockFetch(200, { id: 'a1' });
    await api.updateArray('a1', { name: 'x' });
    expect(lastCall(spy)).toEqual({ url: '/api/storage/arrays/a1', method: 'PATCH' });

    spy = mockFetch(204, null);
    await api.deleteArray('a1');
    expect(lastCall(spy).method).toBe('DELETE');

    spy = mockFetch(201, { id: 'v1' });
    await api.addVolume('a1', { name: 'vol' });
    expect(lastCall(spy)).toEqual({ url: '/api/storage/arrays/a1/volumes', method: 'POST' });

    spy = mockFetch(204, null);
    await api.deleteVolume('a1', 'v1');
    expect(lastCall(spy).url).toBe('/api/storage/arrays/a1/volumes/v1');

    spy = mockFetch(201, { id: 'l1' });
    await api.addLun('v1', { name: 'lun' });
    expect(lastCall(spy)).toEqual({ url: '/api/storage/volumes/v1/luns', method: 'POST' });

    spy = mockFetch(204, null);
    await api.deleteLun('v1', 'l1');
    expect(lastCall(spy).url).toBe('/api/storage/volumes/v1/luns/l1');

    spy = mockFetch(201, { id: 's1' });
    await api.addShare('v1', { export_path: '/x' });
    expect(lastCall(spy)).toEqual({ url: '/api/storage/volumes/v1/shares', method: 'POST' });

    spy = mockFetch(204, null);
    await api.deleteShare('v1', 's1');
    expect(lastCall(spy).url).toBe('/api/storage/volumes/v1/shares/s1');
  });
});
