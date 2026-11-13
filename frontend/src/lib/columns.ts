export interface ColumnConfig {
  key: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'name', visible: true, order: 0 },
  { key: 'platform', visible: true, order: 1 },
  { key: 'cluster', visible: true, order: 2 },
  { key: 'status', visible: true, order: 3 },
  { key: 'resources', visible: true, order: 4 },
  { key: 'criticality', visible: true, order: 5 },
  { key: 'private_ip', visible: true, order: 6 },
  { key: 'updated_at', visible: true, order: 7 },
  { key: 'fqdn', visible: false, order: 8 },
  { key: 'environment', visible: false, order: 9 },
  { key: 'vm_type', visible: false, order: 11 },
  { key: 'datacenter', visible: false, order: 12 },
  { key: 'node', visible: false, order: 13 },
  { key: 'os_family', visible: false, order: 14 },
  { key: 'owner', visible: false, order: 15 },
  { key: 'business_owner', visible: false, order: 16 },
  { key: 'technical_owner', visible: false, order: 17 },
  { key: 'pmp_enabled', visible: false, order: 18 },
  { key: 'monitoring_enabled', visible: false, order: 19 },
  { key: 'backup_enabled', visible: false, order: 20 },
  { key: 'ha_enabled', visible: false, order: 21 },
  { key: 'health_score', visible: false, order: 22 },
  { key: 'tags', visible: false, order: 23 },
  { key: 'created_at', visible: false, order: 24 },
  { key: 'public_ip', visible: false, order: 25 },
  { key: 'backup_ip', visible: false, order: 26 },
];

export const COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  platform: 'Platform',
  cluster: 'Cluster',
  status: 'Status',
  resources: 'Resources',
  criticality: 'Criticality',
  private_ip: 'Private IP',
  public_ip: 'Public IP',
  backup_ip: 'Backup IP',
  updated_at: 'Updated',
  fqdn: 'FQDN',
  environment: 'Environment',
  vm_type: 'Type',
  datacenter: 'Datacenter',
  node: 'Node',
  os_family: 'OS',
  owner: 'Owner',
  business_owner: 'Business Owner',
  technical_owner: 'Technical Owner',
  pmp_enabled: 'PMP',
  monitoring_enabled: 'Monitoring',
  backup_enabled: 'Backup',
  ha_enabled: 'HA',
  health_score: 'Health',
  tags: 'Tags',
  created_at: 'Created',
};

// Merge in columns added after the user saved their preferences.
export function mergeWithDefaults(saved: ColumnConfig[]): ColumnConfig[] {
  const savedKeys = new Set(saved.map((c) => c.key));
  let nextOrder = saved.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  const merged = [...saved];
  for (const def of DEFAULT_COLUMNS) {
    if (!savedKeys.has(def.key)) merged.push({ key: def.key, visible: false, order: nextOrder++ });
  }
  return merged;
}

export function toggleColumnConfig(columns: ColumnConfig[], key: string): ColumnConfig[] {
  return columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c));
}

export function reorderColumnConfig(columns: ColumnConfig[], fromKey: string, toKey: string): ColumnConfig[] | null {
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  const fromIdx = sorted.findIndex((c) => c.key === fromKey);
  const toIdx = sorted.findIndex((c) => c.key === toKey);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null;
  const reordered = [...sorted];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  return reordered.map((c, i) => ({ ...c, order: i }));
}
