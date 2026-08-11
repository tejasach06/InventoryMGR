import { AccentId } from '../lib/accentPresets';

export type UserRole = 'admin' | 'editor' | 'viewer';
export type Platform = 'proxmox' | 'vmware';
export type VmStatus = 'running' | 'powered_off' | 'decommissioned' | 'unknown';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';
export type VmType = 'permanent' | 'temporary';
export type Environment = 'production' | 'development' | 'testing' | 'uat' | 'dr' | 'staging' | 'sandbox';
export type ImportAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid';
export type DropdownCategory = 'cpu' | 'datacenter' | 'disk' | 'os' | 'cluster';
export type StorageVendor = 'synology' | 'netapp';
export type OsFamily = 'linux' | 'windows';

export interface DropdownOption {
  id: string;
  category: DropdownCategory;
  value: string;
  family: OsFamily | null;
}

export interface DropdownOptions {
  cpu: string[];
  datacenter: string[];
  disk: string[];
  os: string[];
  cluster: string[];
  os_by_family: Record<OsFamily, string[]>;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  auth_source: string;
  created_at?: string;
  updated_at?: string;
}

export interface SetupStatus {
  setup_required: boolean;
}

export interface Disk {
  id: string;
  vm_id: string;
  disk_name: string;
  storage_name: string | null;
  size_gb: number;
  storage_type: string | null;
  sort_order: number;
}

export type NetworkRole = 'private' | 'public' | 'backup';

export interface Network {
  id: string;
  vm_id: string;
  ip_address: string;
  role: NetworkRole;
  sort_order: number;
}

export interface Application {
  id: string;
  vm_id: string;
  app_name: string;
  app_owner: string | null;
  description: string | null;
}

export interface AuditLogEntry {
  id: string;
  vm_id: string;
  user_id: string;
  user?: { id: string; email: string } | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface Vm {
  id: string;
  external_id: string | null;
  name: string;
  fqdn: string | null;
  description: string | null;
  platform: Platform;
  datacenter: string | null;
  sr_id: string | null;
  cluster: string;
  node: string | null;
  status: VmStatus;
  environment: Environment;
  criticality: Criticality;
  vm_type: VmType;
  cpu_cores: number;
  memory_mb: number;
  os_family: OsFamily | null;
  os_distribution: string | null;
  os_version: string | null;
  owner: string | null;
  business_owner: string | null;
  technical_owner: string | null;
  pmp_enabled: boolean;
  monitoring_enabled: boolean;
  backup_enabled: boolean;
  backup_location: string | null;
  ha_enabled: boolean;
  tags: string[];
  last_patch_date: string | null;
  last_vuln_scan_date: string | null;
  security_remarks: string | null;
  decommission_date: string | null;
  last_verified_at: string | null;
  disks: Disk[];
  networks: Network[];
  applications: Application[];
  health_score: number;
  created_by_id: string;
  updated_by_id: string;
  created_at: string;
  updated_at: string;
}

export type VmPayload = Omit<Vm, 'id' | 'disks' | 'networks' | 'applications' | 'health_score' | 'created_by_id' | 'updated_by_id' | 'created_at' | 'updated_at'> & {
  disks: Omit<Disk, 'id' | 'vm_id'>[];
  networks: Omit<Network, 'id' | 'vm_id'>[];
};

export interface VmList {
  items: Vm[];
  total: number;
  limit: number;
  offset: number;
}
export type BulkPatch = Record<string, string | boolean | string[]>;
export interface BulkResult {
  updated: number;
  failed: { id: string; message: string }[];
}

export interface DashboardAlertVm {
  id: string;
  name: string;
  environment: Environment;
  days: number;
}

export interface ReportSummary {
  total_vms: number;
  counts: Record<string, number>;
}

export interface DashboardStats {
  total: number;
  linux: number;
  windows: number;
  production: number;
  development: number;
  test_uat: number;
  powered_off: number;
  without_monitoring: number;
  without_applications: number;
  total_vcpu?: number;
  total_memory_gb?: number;
  total_disk_gb?: number;
  by_status?: Record<string, number>;
  by_environment?: Record<string, number>;
  by_criticality?: Record<string, number>;
  by_os_family?: Record<string, number>;
  shutdown_stale: DashboardAlertVm[];
  decommission_overdue: DashboardAlertVm[];
  missing_ip: DashboardAlertVm[];
}

export interface ImportRowError {
  field: string;
  message: string;
}

export interface ImportRow {
  id: string;
  row_number: number;
  raw: Record<string, unknown>;
  normalized: Partial<VmPayload> | null;
  action: ImportAction;
  target_vm_id: string | null;
  errors: ImportRowError[];
  warnings: ImportRowError[];
  changes: Record<string, [unknown, unknown]>;
}

export interface ImportBatch {
  id: string;
  filename: string;
  status: 'previewed' | 'committed' | 'cancelled';
  summary: Record<ImportAction, number> & Record<string, number>;
  ignored_columns: string[];
  field_changes: Record<string, number>;
  rows: ImportRow[];
  created_at: string;
  committed_at: string | null;
}

export interface CommitResult {
  created: number;
  updated: number;
}

export interface DueVm {
  vm_id: string;
  name: string;
  decommission_date: string;
  days_remaining: number;
  unread: boolean;
}

export interface AppSettings {
  decommission_notify_days: number;
  storage_usage_warn_pct: number;
}

export interface LdapConfig {
  enabled: boolean;
  server_uri: string;
  start_tls: boolean;
  verify_tls: boolean;
  bind_dn: string | null;
  bind_password_set: boolean;
  user_base_dn: string;
  user_filter: string;
  email_attribute: string;
  group_attribute: string;
  admin_group_dn: string | null;
  editor_group_dn: string | null;
  viewer_group_dn: string | null;
  default_role: 'viewer' | 'editor' | 'admin';
}

export interface Lun {
  id: string;
  volume_id: string;
  name: string;
  size_gb: number;
  used_gb: number | null;
  target_iqn: string | null;
  cluster: string | null;
  status: string | null;
  sort_order: number;
}

export interface NfsShare {
  id: string;
  volume_id: string;
  export_path: string;
  used_gb: number | null;
  allowed_clients: string | null;
  notes: string | null;
  sort_order: number;
}

export interface StorageVolume {
  id: string;
  array_id: string;
  name: string;
  capacity_gb: number;
  used_gb: number;
  notes: string | null;
  sort_order: number;
  used_pct: number | null;
  over_threshold: boolean;
  luns: Lun[];
  shares: NfsShare[];
}

export interface StorageArray {
  id: string;
  name: string;
  vendor: StorageVendor;
  model: string | null;
  mgmt_host: string | null;
  datacenter: string | null;
  description: string | null;
  total_capacity_gb: number;
  used_capacity_gb: number;
  notes: string | null;
  used_pct: number | null;
  over_threshold: boolean;
  volumes: StorageVolume[];
  created_at: string;
  updated_at: string;
}

export interface StorageArrayListItem {
  id: string;
  name: string;
  vendor: StorageVendor;
  datacenter: string | null;
  total_capacity_gb: number;
  used_capacity_gb: number;
  used_pct: number | null;
  over_threshold: boolean;
  volume_count: number;
  lun_count: number;
  share_count: number;
}

export type ArrayPayload = Partial<Omit<StorageArray, 'id' | 'used_pct' | 'over_threshold' | 'volumes' | 'created_at' | 'updated_at'>> & {
  name: string;
  vendor: StorageVendor;
};

export interface NodeIpAddress {
  label: string;
  address: string;
}

export interface PhysicalNode {
  id: string;
  cluster_id: string;
  name: string;
  cpu_model: string | null;
  cpu_cores: number;
  cpu_threads: number;
  ram_total_gb: number;
  ram_used_gb: number | null;
  storage_usable_gb: number;
  datacenter: string | null;
  rack: string | null;
  rack_unit: string | null;
  ip_addresses: NodeIpAddress[];
  notes: string | null;
  sort_order: number;
}

export interface PhysicalClusterListItem {
  id: string;
  name: string;
  description: string | null;
  node_count: number;
  total_ram_gb: number;
  total_storage_gb: number;
}

export interface PhysicalCluster {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  nodes: PhysicalNode[];
  created_at: string;
  updated_at: string;
}

export type ClusterPayload = Partial<Omit<PhysicalCluster, 'id' | 'nodes' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export type NodePayload = Partial<Omit<PhysicalNode, 'id' | 'cluster_id'>> & {
  name: string;
};
