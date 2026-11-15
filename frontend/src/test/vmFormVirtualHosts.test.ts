import { describe, expect, it } from 'vitest';
import { vmFormSchema, VIRTUAL_HOST_MAX_COUNT, VIRTUAL_HOST_MAX_LEN } from '../lib/vmForm';

const base = { name: 'vm-1', platform: 'proxmox', cluster: 'c', status: 'running', criticality: 'medium', cpu_cores: 2, memory_mb: 2 };

function vhIssues(virtual_hosts: string[]) {
  const result = vmFormSchema.safeParse({ ...base, virtual_hosts });
  return result.success ? [] : result.error.issues.filter((i) => i.path[0] === 'virtual_hosts');
}

describe('virtual_hosts bounds', () => {
  it('accepts an item at the length limit', () => {
    expect(vhIssues(['x'.repeat(VIRTUAL_HOST_MAX_LEN)])).toEqual([]);
  });

  it('rejects an item one character over the limit', () => {
    expect(vhIssues(['x'.repeat(VIRTUAL_HOST_MAX_LEN + 1)]).length).toBeGreaterThan(0);
  });

  it('accepts exactly the maximum count and rejects one more', () => {
    const atLimit = Array.from({ length: VIRTUAL_HOST_MAX_COUNT }, (_, i) => `h${i}.local`);
    expect(vhIssues(atLimit)).toEqual([]);
    expect(vhIssues([...atLimit, 'extra.local']).length).toBeGreaterThan(0);
  });

  it('trims and dedupes case-insensitively, keeping commas and labels intact', () => {
    const result = vmFormSchema.safeParse({ ...base, virtual_hosts: ['  Shop, EU ', 'shop, eu', 'portal.local'] });
    if (result.success) expect(result.data.virtual_hosts).toEqual(['Shop, EU', 'portal.local']);
  });
});
