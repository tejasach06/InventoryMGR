import { describe, expect, it } from 'vitest';

import { DEFAULT_COLUMNS, mergeWithDefaults } from '../hooks/useColumnPreferences';

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
