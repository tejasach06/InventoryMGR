import { describe, expect, it } from 'vitest';
import { createDefaultVmFormValues, validateVmFormInput } from '../lib/vmForm';

describe('vmFormSchema', () => {
  it('normalizes valid form values into the API payload shape', () => {
    const parsed = validateVmFormInput({
      ...createDefaultVmFormValues(),
      name: '  pve-app-01  ',
      platform: 'proxmox',
      cluster: ' pve-cluster-a ',
      status: 'running',
      cpu_cores: '4',
      memory_mb: '8',
      external_id: ' ',
      tags: 'web; critical ;',
      ha_enabled: true,
      backup_enabled: true,
      os_family: 'linux',
      criticality: 'high',
      lifecycle: 'active',
      last_verified_at: '2026-06-13',
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toMatchObject({
      name: 'pve-app-01',
      cluster: 'pve-cluster-a',
      external_id: null,
      cpu_cores: 4,
      memory_mb: 8192,
      tags: ['web', 'critical'],
      ha_enabled: true,
      backup_enabled: true,
      os_family: 'linux',
      last_verified_at: '2026-06-13',
    });
  });

  it('maps an empty os_family to null and keeps a selected family', () => {
    const base = {
      ...createDefaultVmFormValues(),
      name: 'osfam',
      cluster: 'c1',
      status: 'running' as const,
      cpu_cores: '2',
      memory_mb: '4',
      criticality: 'medium' as const,
      lifecycle: 'active' as const,
    };

    const blank = validateVmFormInput({ ...base, os_family: '' });
    expect(blank.ok).toBe(true);
    expect(blank.data?.os_family).toBeNull();

    const linux = validateVmFormInput({ ...base, os_family: 'linux' });
    expect(linux.ok).toBe(true);
    expect(linux.data?.os_family).toBe('linux');
  });

  it('parses semicolon-separated tags and trims the SR-ID', () => {
    const parsed = validateVmFormInput({
      ...createDefaultVmFormValues(),
      name: 'tag-vm',
      cluster: 'c1',
      status: 'running',
      cpu_cores: '4',
      memory_mb: '8',
      tags: 'db; prod; legacy ',
      sr_id: ' SR-2048 ',
      criticality: 'high',
      lifecycle: 'active',
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toMatchObject({ tags: ['db', 'prod', 'legacy'], sr_id: 'SR-2048' });
  });

  it('reports actionable validation errors for blank required fields, negative numbers, and bad dates', () => {
    const parsed = validateVmFormInput({
      ...createDefaultVmFormValues(),
      name: '   ',
      cluster: '',
      cpu_cores: '-1',
      memory_mb: 'not-a-number',
      last_verified_at: '06/13/2026',
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toMatchObject({
      name: 'Name is required.',
      cluster: 'Cluster is required.',
      cpu_cores: 'CPU cores must be 0 or greater.',
      last_verified_at: 'Date must use YYYY-MM-DD.',
    });
    expect(parsed.errors.memory_mb).toBeTruthy();
  });
});
