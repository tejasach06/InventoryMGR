import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS, presetColumns } from '../lib/exportOptions';

describe('presetColumns', () => {
  it('maps stored legacy fqdn to virtual_hosts and dedupes', () => {
    expect(presetColumns(['name', 'fqdn', 'virtual_hosts'])).toEqual(['name', 'virtual_hosts']);
  });

  it('keeps only known export columns', () => {
    expect(presetColumns(['fqdn', 'not_a_column'])).toEqual(['virtual_hosts']);
  });

  it('exposes virtual_hosts as an export column', () => {
    expect(EXPORT_COLUMNS).toContain('virtual_hosts');
  });

  it('exposes ip_mappings as an export column', () => {
    expect(EXPORT_COLUMNS).toContain('ip_mappings');
  });
});
