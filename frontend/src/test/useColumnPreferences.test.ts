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
});
