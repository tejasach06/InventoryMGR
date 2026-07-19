import { api } from '../../api/client';
import type { Filters, FilterName } from '../../routes/InventoryPage';

export type AdvancedFilterName = Exclude<FilterName, 'q'>;
export type DynamicFilterName = 'owner' | 'cluster' | 'node' | 'tag' | 'application';
export type CoreFilterName = 'status' | 'platform' | 'criticality';

export type AdvancedFieldConfig =
  | { kind: 'multiSelect'; options: readonly string[]; labels?: Record<string, string> }
  | { kind: 'dynamicMultiSelect'; labels?: Record<string, string> };

export const advancedFilterConfig: Record<AdvancedFilterName, AdvancedFieldConfig> = {
  status: { kind: 'multiSelect', options: ['running', 'powered_off', 'suspended', 'archived', 'decommissioned', 'unknown'] as const },
  platform: { kind: 'multiSelect', options: ['proxmox', 'vmware'] as const },
  criticality: { kind: 'multiSelect', options: ['critical', 'high', 'medium', 'low'] as const },
  lifecycle: { kind: 'multiSelect', options: ['active', 'planned', 'retiring', 'retired'] as const },
  environment: { kind: 'multiSelect', options: ['production', 'staging', 'uat', 'testing', 'development', 'dr', 'sandbox'] as const },
  cluster: { kind: 'dynamicMultiSelect' },
  node: { kind: 'dynamicMultiSelect' },
  os_family: { kind: 'multiSelect', options: ['linux', 'windows'] as const },
  owner: { kind: 'dynamicMultiSelect' },
  application: { kind: 'dynamicMultiSelect' },
  tag: { kind: 'dynamicMultiSelect' },
  monitoring_enabled: { kind: 'multiSelect', options: ['true', 'false'] as const, labels: { true: 'Enabled', false: 'Disabled' } },
  pmp_enabled: { kind: 'multiSelect', options: ['true', 'false'] as const, labels: { true: 'Enabled', false: 'Disabled' } },
  ip_role: { kind: 'multiSelect', options: ['private', 'public', 'backup'] as const },
  health: { kind: 'multiSelect', options: ['healthy', 'warning', 'critical', 'unknown'] as const },
};

export const advancedFilterLabels: Record<AdvancedFilterName, string> = {
  status: 'Status',
  platform: 'Platform',
  criticality: 'Criticality',
  lifecycle: 'Lifecycle',
  environment: 'Environment',
  cluster: 'Cluster',
  node: 'Node',
  os_family: 'OS Family',
  owner: 'Owner',
  application: 'Application',
  tag: 'Tag',
  monitoring_enabled: 'Monitoring',
  pmp_enabled: 'PMP',
  ip_role: 'IP Role',
  health: 'Health',
};

// Every non-search filter now lives in the drawer, so the groups must cover
// the core three as well — nothing is rendered inline in the card any more.
export const filterGroups: { label: string; filters: AdvancedFilterName[] }[] = [
  { label: 'Core', filters: ['status', 'platform', 'criticality'] },
  { label: 'Infrastructure', filters: ['cluster', 'node', 'ip_role'] },
  { label: 'Lifecycle & State', filters: ['lifecycle', 'health'] },
  { label: 'Ownership & Environment', filters: ['environment', 'owner', 'os_family', 'application', 'tag'] },
  { label: 'Features', filters: ['monitoring_enabled', 'pmp_enabled'] },
];

export const coreFilters = ['status', 'platform', 'criticality'] as const;

export const coreFilterTypes: Record<CoreFilterName, 'status' | 'criticality' | 'platform'> = {
  status: 'status',
  platform: 'platform',
  criticality: 'criticality',
};

export const dynamicFilterNames = ['owner', 'cluster', 'node', 'tag', 'application'] as const;

export const dynamicFetchers: Record<DynamicFilterName, () => Promise<string[]>> = {
  owner: api.listVmOwners,
  cluster: api.listVmClusters,
  node: api.listVmNodes,
  tag: api.listVmTags,
  application: api.listVmApplications,
};

export const emptyFilterState: Filters = {
  q: [],
  platform: [],
  status: [],
  criticality: [],
  cluster: [],
  lifecycle: [],
  environment: [],
  monitoring_enabled: [],
  node: [],
  os_family: [],
  owner: [],
  pmp_enabled: [],
  tag: [],
  application: [],
  ip_role: [],
  health: [],
};

const chipTypeOverrides: Partial<Record<AdvancedFilterName, 'environment' | 'platform' | 'os_family' | 'lifecycle' | 'criticality'>> = {
  criticality: 'criticality',
  platform: 'platform',
  environment: 'environment',
  os_family: 'os_family',
  lifecycle: 'lifecycle',
};

/** Semantic colour family a chip should use; anything unmapped falls back to status. */
export function chipTypeFor(
  name: AdvancedFilterName,
): 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle' {
  return chipTypeOverrides[name] ?? 'status';
}
