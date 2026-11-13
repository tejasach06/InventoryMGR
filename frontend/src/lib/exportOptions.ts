import { type ColumnConfig } from './columns';
import { DEFAULT_PAGE_SIZE, paramsFromFilters, type Filters } from './inventoryFilters';

// shortcut: mirrors SCALARS + DERIVED in backend-rust/src/api/inventory/export.rs;
// an unknown key 422s there, so drift fails loudly. Upgrade to a /vms/export/columns endpoint if it drifts.
export const EXPORT_GROUPS: { title: string; columns: [string, string][] }[] = [
  { title: 'Identity', columns: [
    ['name', 'Name'], ['fqdn', 'Hostname (FQDN)'], ['external_id', 'External ID'], ['sr_id', 'Request IDs (VM + IP)'],
    ['description', 'Description'], ['tags', 'Tags'], ['applications', 'Applications'],
  ] },
  { title: 'Where it runs', columns: [
    ['platform', 'Platform'], ['datacenter', 'Datacenter'], ['cluster', 'Cluster'], ['node', 'Host node'],
    ['environment', 'Environment'], ['vm_type', 'VM type'],
  ] },
  { title: 'Status & importance', columns: [
    ['status', 'Status'], ['criticality', 'Criticality'], ['health_score', 'Health score'],
  ] },
  { title: 'Size & software', columns: [
    ['cpu_cores', 'CPU cores'], ['memory_mb', 'Memory (MB)'], ['disks', 'Disks'], ['os_family', 'OS family'],
    ['os_distribution', 'OS distribution'], ['os_version', 'OS version'],
  ] },
  { title: 'Network', columns: [['private_ip', 'Private IP'], ['public_ip', 'Public IP'], ['backup_ip', 'Backup IP']] },
  { title: 'People', columns: [['owner', 'Owner'], ['business_owner', 'Business owner'], ['technical_owner', 'Technical owner']] },
  { title: 'Protection & security', columns: [
    ['monitoring_enabled', 'Monitoring on'], ['backup_enabled', 'Backup on'], ['backup_location', 'Backup location'],
    ['ha_enabled', 'High availability'], ['pmp_enabled', 'PMP remote access'], ['security_remarks', 'Security remarks'],
  ] },
  { title: 'Dates', columns: [
    ['last_patch_date', 'Last patched'], ['last_vuln_scan_date', 'Last vulnerability scan'],
    ['last_verified_at', 'Last verified'], ['decommission_date', 'Decommission date'],
    ['created_at', 'Created'], ['updated_at', 'Last updated'],
  ] },
];

export const EXPORT_COLUMNS: string[] = EXPORT_GROUPS.flatMap((g) => g.columns.map(([key]) => key));

// The short list most people want in a spreadsheet; Reports opens with this.
export const COMMON_COLUMNS = [
  'name', 'platform', 'cluster', 'status', 'criticality', 'environment', 'cpu_cores', 'memory_mb',
  'disks', 'private_ip', 'owner', 'updated_at',
];

export type ExportFormat = 'csv' | 'xlsx';
export type DiskLayout = 'joined' | 'rows';
export type ExportScope = 'selected' | 'filtered' | 'all';

export interface ExportOptions {
  scope: ExportScope;
  ids: string[];
  filters: Filters;
  columns: string[];
  format: ExportFormat;
  diskLayout: DiskLayout;
}

export interface ExportPreset {
  name: string;
  columns: string[];
  format: ExportFormat;
  diskLayout: DiskLayout;
  filters: Filters;
}

export function exportColumnLabel(key: string): string {
  for (const g of EXPORT_GROUPS) {
    const hit = g.columns.find(([k]) => k === key);
    if (hit) return hit[1];
  }
  return key;
}

// List columns -> export columns, in list order. `resources` is two export fields.
export function columnsFromList(prefs: ColumnConfig[]): string[] {
  const known = new Set<string>(EXPORT_COLUMNS);
  const keys = [...prefs]
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order)
    .flatMap((c) => (c.key === 'resources' ? ['cpu_cores', 'memory_mb'] : [c.key]));
  return keys.filter((k, i) => known.has(k) && keys.indexOf(k) === i);
}

const NO_VIEW = { page: 1, size: DEFAULT_PAGE_SIZE, sort: null, dir: 'asc' } as const;

export function exportParams(o: ExportOptions, format: ExportFormat | 'json' = o.format): URLSearchParams {
  const p =
    o.scope === 'selected' ? new URLSearchParams(o.ids.map((id) => ['ids', id]))
    : o.scope === 'all' ? new URLSearchParams({ all: 'true' })
    : paramsFromFilters(o.filters, NO_VIEW);
  p.set('columns', o.columns.join(','));
  if (format !== 'csv') p.set('format', format);
  if (o.diskLayout === 'rows') p.set('disk_layout', 'rows');
  return p;
}

const PRESETS_KEY = 'inventory-export-presets';

export function loadPresets(): ExportPreset[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: ExportPreset[]): void {
  window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
