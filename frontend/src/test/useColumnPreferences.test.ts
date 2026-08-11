import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/core';
import { settings as settingsApi } from '../api/settings';
import { DEFAULT_COLUMNS, mergeWithDefaults, useColumnPreferences } from '../hooks/useColumnPreferences';

describe('mergeWithDefaults', () => {
  it('appends newly added columns as hidden after saved ones', () => {
    const saved = [
      { key: 'name', visible: true, order: 0 },
      { key: 'status', visible: false, order: 1 },
    ];
    const merged = mergeWithDefaults(saved);
    expect(merged.map((c) => c.key)).toContain('fqdn');
    expect(merged.map((c) => c.key)).toContain('owner');
    const fqdn = merged.find((c) => c.key === 'fqdn')!;
    expect(fqdn.visible).toBe(false);
    expect(fqdn.order).toBeGreaterThan(1);
    // Saved entries untouched.
    expect(merged[0]).toEqual(saved[0]);
    expect(merged[1]).toEqual(saved[1]);
  });

  it('is a no-op when everything is already present', () => {
    const merged = mergeWithDefaults(DEFAULT_COLUMNS);
    expect(merged).toHaveLength(DEFAULT_COLUMNS.length);
  });

  it('leaves a pre-roles layout intact after the backend rewrites ip_address', () => {
    // What GET /user/preferences/inventory returns for a layout saved before
    // network roles existed: ip_address already rewritten to private_ip in its
    // original slot, role columns appended hidden. Merging that must not reset
    // the layout or duplicate a key — the user's visible columns are the thing
    // being protected.
    const fromBackend = [
      { key: 'name', visible: true, order: 0 },
      { key: 'private_ip', visible: true, order: 6 },
      { key: 'public_ip', visible: false, order: 27 },
      { key: 'backup_ip', visible: false, order: 28 },
    ];
    const merged = mergeWithDefaults(fromBackend);

    const keys = merged.map((c) => c.key);
    expect(keys.filter((k) => k === 'private_ip')).toHaveLength(1);
    expect(merged.find((c) => c.key === 'private_ip')).toEqual({
      key: 'private_ip',
      visible: true,
      order: 6,
    });
    // Nothing the user could not see before becomes visible.
    expect(merged.filter((c) => c.visible).map((c) => c.key)).toEqual(['name', 'private_ip']);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useColumnPreferences', () => {
  it('loads saved columns, merges defaults, and exposes visible columns sorted by order', async () => {
    vi.spyOn(settingsApi, 'getColumnPreferences').mockResolvedValue({
      columns: [
        { key: 'status', visible: true, order: 2 },
        { key: 'name', visible: true, order: 1 },
      ],
    });

    const { result } = renderHook(() => useColumnPreferences('inventory'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.columns.map((c) => c.key)).toContain('fqdn');
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual(['name', 'status']);
  });

  it('reports load failures using the API detail message', async () => {
    vi.spyOn(settingsApi, 'getColumnPreferences').mockRejectedValue(new ApiError(500, 'Prefs unavailable'));

    const { result } = renderHook(() => useColumnPreferences('inventory'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Prefs unavailable');
  });

  it('toggles a column and reports debounced save failures', async () => {
    vi.spyOn(settingsApi, 'getColumnPreferences').mockResolvedValue({ columns: DEFAULT_COLUMNS });
    vi.spyOn(settingsApi, 'updateColumnPreferences').mockRejectedValue(new ApiError(400, 'Save failed'));
    const { result } = renderHook(() => useColumnPreferences('inventory'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleColumn('fqdn'));
    expect(result.current.columns.find((c) => c.key === 'fqdn')?.visible).toBe(true);

    await waitFor(() => expect(result.current.error).toBe('Save failed'));
    expect(settingsApi.updateColumnPreferences).toHaveBeenCalledWith('inventory', expect.arrayContaining([expect.objectContaining({ key: 'fqdn', visible: true })]));
  });

  it('reorders columns, ignores invalid moves, and resets to defaults', async () => {
    vi.spyOn(settingsApi, 'getColumnPreferences').mockResolvedValue({ columns: DEFAULT_COLUMNS });
    const saveSpy = vi.spyOn(settingsApi, 'updateColumnPreferences').mockResolvedValue({ columns: DEFAULT_COLUMNS });
    const { result } = renderHook(() => useColumnPreferences('inventory'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.reorderColumns('missing', 'name'));
    act(() => result.current.reorderColumns('name', 'name'));
    expect(saveSpy).not.toHaveBeenCalled();

    act(() => result.current.reorderColumns('status', 'name'));
    expect(result.current.columns[0].key).toBe('status');
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    act(() => result.current.resetToDefault());
    expect(result.current.columns).toEqual(DEFAULT_COLUMNS);
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
  });
});
