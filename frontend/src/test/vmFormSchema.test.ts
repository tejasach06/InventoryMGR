import { describe, expect, it } from 'vitest';
import { createDefaultVmFormValues, validateVmFormInput } from '../routes/VmFormPage';

describe('vmFormSchema', () => {
  it('normalizes valid form values into the API payload shape', () => {
    const parsed = validateVmFormInput({
      ...createDefaultVmFormValues(),
      name: '  pve-app-01  ',
      platform: 'proxmox',
      environment: ' lab ',
      cluster: ' pve-cluster-a ',
      host: ' pve01 ',
      status: 'running',
      cpu_cores: '4',
      memory_mb: '8192',
      disk_gb: '120',
      external_id: ' ',
      ip_addresses: '10.0.0.10; 10.0.0.11; ',
      tags: 'web; critical ;',
      ha_enabled: true,
      criticality: 'high',
      lifecycle: 'active',
      last_verified_at: '2026-06-13',
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toMatchObject({
      name: 'pve-app-01',
      environment: 'lab',
      cluster: 'pve-cluster-a',
      host: 'pve01',
      external_id: null,
      cpu_cores: 4,
      memory_mb: 8192,
      disk_gb: 120,
      ip_addresses: ['10.0.0.10', '10.0.0.11'],
      tags: ['web', 'critical'],
      ha_enabled: true,
      last_verified_at: '2026-06-13',
    });
  });

  it('reports actionable validation errors for blank required fields, negative numbers, and bad dates', () => {
    const parsed = validateVmFormInput({
      ...createDefaultVmFormValues(),
      name: '   ',
      environment: '',
      cluster: '',
      host: '',
      cpu_cores: '-1',
      memory_mb: 'not-a-number',
      disk_gb: '10',
      last_verified_at: '06/13/2026',
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toMatchObject({
      name: 'Name is required.',
      environment: 'Environment is required.',
      cluster: 'Cluster is required.',
      host: 'Host is required.',
      cpu_cores: 'CPU cores must be 0 or greater.',
      last_verified_at: 'Last verified date must use YYYY-MM-DD.',
    });
    expect(parsed.errors.memory_mb).toBeTruthy();
  });
});
