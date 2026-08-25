import { afterEach, describe, expect, it, vi } from 'vitest';
import { backups } from '../api/backups';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backups API client', () => {
  it('overview calls GET /backups', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ backups: [], jobs: [], settings: { enabled: false, hour_utc: 2, retention: 7 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const data = await backups.overview();
    expect(data.settings.enabled).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/backups',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('create calls POST /backups', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'job-1', kind: 'manual', status: 'success' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const data = await backups.create();
    expect(data.id).toBe('job-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/backups',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('remove calls DELETE /backups/:name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await backups.remove('inventorymgr-dump.dump');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/backups/inventorymgr-dump.dump',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('downloadUrl returns properly formatted URL', () => {
    const url = backups.downloadUrl('foo bar.dump');
    expect(url).toBe('/api/backups/foo%20bar.dump/download');
  });

  it('updateSettings calls PATCH /backups/settings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, hour_utc: 4, retention: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const data = await backups.updateSettings({ enabled: true, hour_utc: 4 });
    expect(data.enabled).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/backups/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: true, hour_utc: 4 }),
      })
    );
  });

  it('restore sends FormData with file and confirm=RESTORE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'job-restore', kind: 'restore', status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const dummyFile = new File(['dumpcontent'], 'backup.dump', { type: 'application/octet-stream' });
    const data = await backups.restore(dummyFile);
    expect(data.kind).toBe('restore');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/backups/restore',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    );
  });
});
