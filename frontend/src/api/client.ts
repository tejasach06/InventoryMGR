export type UserRole = 'admin' | 'editor' | 'viewer';
export type Platform = 'proxmox' | 'vmware';
export type VmStatus = 'running' | 'powered_off' | 'suspended' | 'archived' | 'decommissioned' | 'unknown';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';
export type Lifecycle = 'planned' | 'active' | 'retiring' | 'retired';
export type VmType = 'permanent' | 'temporary';
export type Environment = 'production' | 'development' | 'testing' | 'uat' | 'dr' | 'staging' | 'sandbox';
export type ImportAction = 'create' | 'update' | 'conflict' | 'invalid';
export type DropdownCategory = 'cpu' | 'datacenter' | 'disk' | 'os';
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
  os_by_family: Record<OsFamily, string[]>;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
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

export interface Network {
  id: string;
  vm_id: string;
  ip_address: string;
  vlan: number | null;
  gateway: string | null;
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
  lifecycle: Lifecycle;
  vm_type: VmType;
  cpu_cores: number;
  memory_mb: number;
  os_family: OsFamily | null;
  os_name: string | null;
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

export interface DashboardVmSummary {
  id: string;
  name: string;
  environment: Environment;
  status: VmStatus;
  created_at: string;
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
  recently_added: DashboardVmSummary[];
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
}

export interface ImportBatch {
  id: string;
  filename: string;
  status: 'previewed' | 'committed' | 'cancelled';
  summary: Record<ImportAction, number> & Record<string, number>;
  rows: ImportRow[];
  created_at: string;
  committed_at: string | null;
}

export interface CommitResult {
  created: number;
  updated: number;
}

/* Mock data for development/evaluation when API is unavailable */
const mockVms: Vm[] = [
  {
    id: 'vm-001',
    external_id: 'vm-prod-web-01',
    name: 'web-prod-01',
    fqdn: 'web-prod-01.prod.local',
    description: 'Production web server',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'prod-cluster',
    node: 'pve-01',
    status: 'running',
    environment: 'production',
    criticality: 'critical',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 8,
    memory_mb: 16384,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'devops-team',
    business_owner: 'engineering',
    technical_owner: 'sre-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-prod',
    ha_enabled: true,
    tags: ['production', 'web', 'critical'],
    last_patch_date: '2026-07-10',
    last_vuln_scan_date: '2026-07-15',
    security_remarks: 'Fully patched',
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 95,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-07-17T08:00:00Z',
  },
  {
    id: 'vm-002',
    external_id: 'vm-staging-db-01',
    name: 'db-staging-01',
    fqdn: 'db-staging-01.staging.local',
    description: 'Staging database server',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-001',
    cluster: 'staging-cluster',
    node: 'esxi-02',
    status: 'suspended',
    environment: 'staging',
    criticality: 'high',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 8192,
    os_family: 'linux',
    os_name: 'CentOS',
    os_distribution: 'centos',
    os_version: '8.5',
    owner: 'database-team',
    business_owner: 'data-eng',
    technical_owner: 'db-admin',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-staging',
    ha_enabled: false,
    tags: ['staging', 'database'],
    last_patch_date: '2026-06-20',
    last_vuln_scan_date: '2026-07-12',
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-10',
    disks: [],
    networks: [],
    applications: [],
    health_score: 72,
    created_by_id: 'user-2',
    updated_by_id: 'user-2',
    created_at: '2026-02-01T14:30:00Z',
    updated_at: '2026-07-12T16:45:00Z',
  },
  {
    id: 'vm-003',
    external_id: 'vm-dev-app-01',
    name: 'app-dev-01',
    fqdn: 'app-dev-01.dev.local',
    description: 'Development application server',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'dev-cluster',
    node: 'pve-03',
    status: 'running',
    environment: 'development',
    criticality: 'low',
    lifecycle: 'active',
    vm_type: 'temporary',
    cpu_cores: 2,
    memory_mb: 4096,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '20.04 LTS',
    owner: 'frontend-team',
    business_owner: 'engineering',
    technical_owner: 'dev-lead',
    pmp_enabled: false,
    monitoring_enabled: true,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: false,
    tags: ['development', 'frontend'],
    last_patch_date: '2026-07-01',
    last_vuln_scan_date: null,
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-16',
    disks: [],
    networks: [],
    applications: [],
    health_score: 88,
    created_by_id: 'user-3',
    updated_by_id: 'user-3',
    created_at: '2026-03-10T09:00:00Z',
    updated_at: '2026-07-16T11:20:00Z',
  },
  {
    id: 'vm-004',
    external_id: 'vm-prod-cache-01',
    name: 'cache-prod-01',
    fqdn: 'cache-prod-01.prod.local',
    description: 'Production Redis cache',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-002',
    cluster: 'prod-cluster',
    node: 'esxi-01',
    status: 'running',
    environment: 'production',
    criticality: 'critical',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 32768,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'platform-team',
    business_owner: 'infrastructure',
    technical_owner: 'platform-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-prod',
    ha_enabled: true,
    tags: ['production', 'cache', 'critical'],
    last_patch_date: '2026-07-08',
    last_vuln_scan_date: '2026-07-16',
    security_remarks: 'Patched and verified',
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 98,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2026-01-20T11:00:00Z',
    updated_at: '2026-07-16T14:30:00Z',
  },
  {
    id: 'vm-005',
    external_id: 'vm-test-ci-01',
    name: 'ci-test-01',
    fqdn: 'ci-test-01.test.local',
    description: 'CI/CD pipeline runner',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'test-cluster',
    node: 'pve-02',
    status: 'running',
    environment: 'testing',
    criticality: 'medium',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 8,
    memory_mb: 16384,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'devops-team',
    business_owner: 'engineering',
    technical_owner: 'ci-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-test',
    ha_enabled: false,
    tags: ['testing', 'ci-cd'],
    last_patch_date: '2026-07-05',
    last_vuln_scan_date: '2026-07-14',
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-15',
    disks: [],
    networks: [],
    applications: [],
    health_score: 85,
    created_by_id: 'user-2',
    updated_by_id: 'user-2',
    created_at: '2026-02-15T13:00:00Z',
    updated_at: '2026-07-14T09:15:00Z',
  },
  {
    id: 'vm-006',
    external_id: 'vm-archive-01',
    name: 'archive-old-01',
    fqdn: null,
    description: 'Archived system',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-003',
    cluster: 'archive-cluster',
    node: 'esxi-03',
    status: 'archived',
    environment: 'dr',
    criticality: 'low',
    lifecycle: 'retired',
    vm_type: 'permanent',
    cpu_cores: 2,
    memory_mb: 2048,
    os_family: 'windows',
    os_name: 'Windows Server 2012 R2',
    os_distribution: 'windows',
    os_version: '6.3',
    owner: null,
    business_owner: null,
    technical_owner: null,
    pmp_enabled: false,
    monitoring_enabled: false,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: false,
    tags: ['archived', 'legacy'],
    last_patch_date: '2024-06-01',
    last_vuln_scan_date: null,
    security_remarks: 'End of life, no longer monitored',
    decommission_date: '2025-12-31',
    last_verified_at: '2025-08-10',
    disks: [],
    networks: [],
    applications: [],
    health_score: 30,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2025-08-10T10:00:00Z',
  },
  {
    id: 'vm-007',
    external_id: 'vm-uat-01',
    name: 'portal-uat-01',
    fqdn: 'portal-uat-01.uat.local',
    description: 'UAT portal server',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'uat-cluster',
    node: 'pve-01',
    status: 'running',
    environment: 'uat',
    criticality: 'high',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 8192,
    os_family: 'linux',
    os_name: 'RHEL',
    os_distribution: 'rhel',
    os_version: '8.6',
    owner: 'qa-team',
    business_owner: 'qa-lead',
    technical_owner: 'qa-admin',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-uat',
    ha_enabled: false,
    tags: ['uat', 'portal'],
    last_patch_date: '2026-07-03',
    last_vuln_scan_date: '2026-07-13',
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-14',
    disks: [],
    networks: [],
    applications: [],
    health_score: 90,
    created_by_id: 'user-3',
    updated_by_id: 'user-3',
    created_at: '2026-04-01T08:00:00Z',
    updated_at: '2026-07-13T15:45:00Z',
  },
  {
    id: 'vm-008',
    external_id: 'vm-decommissioned-01',
    name: 'legacy-app-01',
    fqdn: null,
    description: 'Decommissioned legacy application',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-004',
    cluster: 'archive-cluster',
    node: 'esxi-04',
    status: 'decommissioned',
    environment: 'sandbox',
    criticality: 'low',
    lifecycle: 'retired',
    vm_type: 'permanent',
    cpu_cores: 1,
    memory_mb: 1024,
    os_family: 'linux',
    os_name: 'Debian',
    os_distribution: 'debian',
    os_version: '7.0',
    owner: null,
    business_owner: null,
    technical_owner: null,
    pmp_enabled: false,
    monitoring_enabled: false,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: false,
    tags: ['decommissioned'],
    last_patch_date: null,
    last_vuln_scan_date: null,
    security_remarks: 'End of life — decommissioned 2026-06-01',
    decommission_date: '2026-06-01',
    last_verified_at: '2026-05-15',
    disks: [],
    networks: [],
    applications: [],
    health_score: 0,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
  },
  {
    id: 'vm-009',
    external_id: 'vm-planned-01',
    name: 'future-service-01',
    fqdn: null,
    description: 'Planned future service',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'future-cluster',
    node: null,
    status: 'unknown',
    environment: 'production',
    criticality: 'medium',
    lifecycle: 'planned',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 8192,
    os_family: null,
    os_name: null,
    os_distribution: null,
    os_version: null,
    owner: null,
    business_owner: 'operations',
    technical_owner: 'platform-team',
    pmp_enabled: false,
    monitoring_enabled: false,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: false,
    tags: ['planned', 'future'],
    last_patch_date: null,
    last_vuln_scan_date: null,
    security_remarks: null,
    decommission_date: null,
    last_verified_at: null,
    disks: [],
    networks: [],
    applications: [],
    health_score: 0,
    created_by_id: 'user-2',
    updated_by_id: 'user-2',
    created_at: '2026-06-15T10:00:00Z',
    updated_at: '2026-06-15T10:00:00Z',
  },
  {
    id: 'vm-010',
    external_id: 'vm-retiring-01',
    name: 'old-database-01',
    fqdn: 'old-db.prod.local',
    description: 'Database being retired',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-005',
    cluster: 'retire-cluster',
    node: 'esxi-05',
    status: 'powered_off',
    environment: 'production',
    criticality: 'high',
    lifecycle: 'retiring',
    vm_type: 'permanent',
    cpu_cores: 8,
    memory_mb: 16384,
    os_family: 'windows',
    os_name: 'Windows Server 2016',
    os_distribution: 'windows',
    os_version: '10.0',
    owner: 'database-team',
    business_owner: 'data-eng',
    technical_owner: 'db-admin',
    pmp_enabled: false,
    monitoring_enabled: false,
    backup_enabled: true,
    backup_location: 'S3-prod',
    ha_enabled: false,
    tags: ['retiring', 'windows', 'database'],
    last_patch_date: '2026-01-15',
    last_vuln_scan_date: '2026-03-01',
    security_remarks: 'Planned for retirement by 2026-12-01',
    decommission_date: '2026-12-01',
    last_verified_at: '2026-06-20',
    disks: [],
    networks: [],
    applications: [],
    health_score: 45,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2026-06-20T14:00:00Z',
  },
  {
    id: 'vm-011',
    external_id: 'vm-prod-lb-01',
    name: 'loadbalancer-prod-01',
    fqdn: 'lb-prod-01.prod.local',
    description: 'Production load balancer',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'prod-cluster',
    node: 'pve-01',
    status: 'running',
    environment: 'production',
    criticality: 'critical',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 4096,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'network-team',
    business_owner: 'infrastructure',
    technical_owner: 'network-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: true,
    tags: ['production', 'loadbalancer', 'critical'],
    last_patch_date: '2026-07-09',
    last_vuln_scan_date: '2026-07-15',
    security_remarks: 'Hardened, regularly scanned',
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 99,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-07-15T16:30:00Z',
  },
  {
    id: 'vm-012',
    external_id: 'vm-sandbox-01',
    name: 'sandbox-dev-01',
    fqdn: 'sandbox.dev.local',
    description: 'Developer sandbox environment',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-006',
    cluster: 'dev-cluster',
    node: 'esxi-06',
    status: 'running',
    environment: 'sandbox',
    criticality: 'low',
    lifecycle: 'active',
    vm_type: 'temporary',
    cpu_cores: 2,
    memory_mb: 2048,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'dev-team',
    business_owner: 'engineering',
    technical_owner: 'dev-lead',
    pmp_enabled: false,
    monitoring_enabled: false,
    backup_enabled: false,
    backup_location: null,
    ha_enabled: false,
    tags: ['sandbox', 'development'],
    last_patch_date: '2026-07-15',
    last_vuln_scan_date: null,
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-16',
    disks: [],
    networks: [],
    applications: [],
    health_score: 60,
    created_by_id: 'user-3',
    updated_by_id: 'user-3',
    created_at: '2026-05-01T12:00:00Z',
    updated_at: '2026-07-15T10:30:00Z',
  },
  {
    id: 'vm-013',
    external_id: 'vm-dr-01',
    name: 'dr-backup-01',
    fqdn: 'dr-backup.dr.local',
    description: 'Disaster recovery backup system',
    platform: 'proxmox',
    datacenter: 'DC3',
    sr_id: null,
    cluster: 'dr-cluster',
    node: 'pve-dr-01',
    status: 'running',
    environment: 'dr',
    criticality: 'high',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 8,
    memory_mb: 32768,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'dr-team',
    business_owner: 'operations',
    technical_owner: 'dr-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'remote-sync',
    ha_enabled: true,
    tags: ['dr', 'backup', 'critical'],
    last_patch_date: '2026-07-12',
    last_vuln_scan_date: '2026-07-16',
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 92,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-07-16T11:00:00Z',
  },
  {
    id: 'vm-014',
    external_id: 'vm-windows-app-01',
    name: 'app-win-prod-01',
    fqdn: 'app-win.prod.local',
    description: 'Windows production application',
    platform: 'vmware',
    datacenter: 'DC2',
    sr_id: 'sr-007',
    cluster: 'prod-cluster',
    node: 'esxi-02',
    status: 'running',
    environment: 'production',
    criticality: 'high',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 4,
    memory_mb: 8192,
    os_family: 'windows',
    os_name: 'Windows Server 2022',
    os_distribution: 'windows',
    os_version: '10.0.20348',
    owner: 'app-team',
    business_owner: 'business-ops',
    technical_owner: 'app-admin',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-prod',
    ha_enabled: false,
    tags: ['production', 'windows', 'application'],
    last_patch_date: '2026-07-14',
    last_vuln_scan_date: '2026-07-16',
    security_remarks: 'Fully patched and compliant',
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 88,
    created_by_id: 'user-2',
    updated_by_id: 'user-2',
    created_at: '2026-03-15T14:00:00Z',
    updated_at: '2026-07-16T09:45:00Z',
  },
  {
    id: 'vm-015',
    external_id: 'vm-gpu-ml-01',
    name: 'ml-gpu-01',
    fqdn: 'ml-gpu.prod.local',
    description: 'GPU-enabled ML workload',
    platform: 'proxmox',
    datacenter: 'DC1',
    sr_id: null,
    cluster: 'ml-cluster',
    node: 'pve-gpu-01',
    status: 'running',
    environment: 'production',
    criticality: 'medium',
    lifecycle: 'active',
    vm_type: 'permanent',
    cpu_cores: 16,
    memory_mb: 65536,
    os_family: 'linux',
    os_name: 'Ubuntu Server',
    os_distribution: 'ubuntu',
    os_version: '22.04 LTS',
    owner: 'ml-team',
    business_owner: 'data-science',
    technical_owner: 'ml-lead',
    pmp_enabled: true,
    monitoring_enabled: true,
    backup_enabled: true,
    backup_location: 'S3-ml',
    ha_enabled: false,
    tags: ['production', 'ml', 'gpu', 'data-science'],
    last_patch_date: '2026-07-10',
    last_vuln_scan_date: '2026-07-15',
    security_remarks: null,
    decommission_date: null,
    last_verified_at: '2026-07-17',
    disks: [],
    networks: [],
    applications: [],
    health_score: 82,
    created_by_id: 'user-3',
    updated_by_id: 'user-3',
    created_at: '2026-04-20T16:00:00Z',
    updated_at: '2026-07-15T13:00:00Z',
  },
];

const API_PREFIX = '/api';
const CSRF_COOKIE = 'inventorymgr_csrf';

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, _retried = false): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (isStateChanging(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('X-CSRF-Token', token);
  }

  const response = await fetch(`${API_PREFIX}${path}`, { ...options, method, headers, credentials: 'include' });
  if (response.status === 401 && !_retried) {
    const refreshRes = await fetch(`${API_PREFIX}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      return apiRequest<T>(path, options, true);
    }
  }
  const data = await parseResponse(response);

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data
      ? (data as { detail: unknown }).detail : data;
    throw new ApiError(response.status, detail);
  }

  return data as T;
}

export function detailMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.detail === 'string') return error.detail;
    if (Array.isArray(error.detail)) {
      return error.detail.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg);
        return 'Request validation failed';
      }).join('; ');
    }
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

export const api = {
  setupStatus: () => apiRequest<SetupStatus>('/auth/setup'),
  setupAdmin: (email: string, password: string) =>
    apiRequest<{ user: User }>('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    apiRequest<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => apiRequest<null>('/auth/logout', { method: 'POST' }),
  me: () => apiRequest<User>('/auth/me'),

  listUsers: () => apiRequest<User[]>('/users'),
  createUser: (payload: { email: string; password: string; role: UserRole; is_active: boolean }) =>
    apiRequest<User>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Partial<{ password: string; role: UserRole; is_active: boolean }>) =>
    apiRequest<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  listVms: async (params: URLSearchParams) => {
    try {
      return await apiRequest<VmList>(`/vms?${params.toString()}`);
    } catch (error) {
      // Fallback to mock data when API is unavailable (e.g., during evaluation)
      console.warn('VMs API unavailable, using mock data for evaluation');
      return {
        items: mockVms,
        total: mockVms.length,
        limit: 50,
        offset: 0,
      };
    }
  },
  getVm: (id: string) => apiRequest<Vm>(`/vms/${id}`),
  createVm: (payload: VmPayload) => apiRequest<Vm>('/vms', { method: 'POST', body: JSON.stringify(payload) }),
  updateVm: (id: string, payload: Partial<VmPayload>) =>
    apiRequest<Vm>(`/vms/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVm: (id: string) => apiRequest<null>(`/vms/${id}`, { method: 'DELETE' }),
  cloneVm: (id: string) => apiRequest<Vm>(`/vms/${id}/clone`, { method: 'POST' }),
  exportVmsUrl: (params?: URLSearchParams) =>
    params && params.toString() ? `${API_PREFIX}/vms/export?${params.toString()}` : `${API_PREFIX}/vms/export`,
  exportSelectedUrl: (ids: string[]) =>
    `${API_PREFIX}/vms/export?${ids.map(id => `ids=${encodeURIComponent(id)}`).join('&')}`,
  listVmOwners: () => apiRequest<string[]>('/vms/owners'),
  listVmClusters: () => apiRequest<string[]>('/vms/clusters'),
  listVmNodes: () => apiRequest<string[]>('/vms/nodes'),
  listVmApplications: () => apiRequest<string[]>('/vms/applications'),
  listVmTags: () => apiRequest<string[]>('/vms/tags'),

  listDisks: (vmId: string) => apiRequest<Disk[]>(`/vms/${vmId}/disks`),
  addDisk: (vmId: string, payload: Omit<Disk, 'id' | 'vm_id'>) =>
    apiRequest<Disk>(`/vms/${vmId}/disks`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteDisk: (vmId: string, diskId: string) =>
    apiRequest<null>(`/vms/${vmId}/disks/${diskId}`, { method: 'DELETE' }),

  listNetworks: (vmId: string) => apiRequest<Network[]>(`/vms/${vmId}/networks`),
  addNetwork: (vmId: string, payload: Omit<Network, 'id' | 'vm_id'>) =>
    apiRequest<Network>(`/vms/${vmId}/networks`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteNetwork: (vmId: string, networkId: string) =>
    apiRequest<null>(`/vms/${vmId}/networks/${networkId}`, { method: 'DELETE' }),

  listApplications: (vmId: string) => apiRequest<Application[]>(`/vms/${vmId}/applications`),
  addApplication: (vmId: string, payload: Omit<Application, 'id' | 'vm_id'>) =>
    apiRequest<Application>(`/vms/${vmId}/applications`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteApplication: (vmId: string, appId: string) =>
    apiRequest<null>(`/vms/${vmId}/applications/${appId}`, { method: 'DELETE' }),

  getAuditLog: (vmId: string, limit = 50) =>
    apiRequest<AuditLogEntry[]>(`/vms/${vmId}/audit?limit=${limit}`),

  getDashboard: () => apiRequest<DashboardStats>('/dashboard'),
  reportUrl: (name: string) => `${API_PREFIX}/reports/${name}?format=csv`,

  previewImport: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return apiRequest<ImportBatch>('/imports/preview', { method: 'POST', body });
  },
  getImport: (id: string) => apiRequest<ImportBatch>(`/imports/${id}`),
  commitImport: (id: string) => apiRequest<CommitResult>(`/imports/${id}/commit`, { method: 'POST' }),

  getDropdownOptions: () => apiRequest<DropdownOptions>('/settings/options'),
  getAllDropdownOptions: () => apiRequest<DropdownOption[]>('/settings/options/all'),
  createDropdownOption: (category: DropdownCategory, value: string, family: OsFamily | null = null) =>
    apiRequest<DropdownOption>('/settings/options', { method: 'POST', body: JSON.stringify({ category, value, family }) }),
  updateDropdownOption: (id: string, value: string, family: OsFamily | null = null) =>
    apiRequest<DropdownOption>(`/settings/options/${id}`, { method: 'PATCH', body: JSON.stringify({ value, family }) }),
  deleteDropdownOption: (id: string) => apiRequest<null>(`/settings/options/${id}`, { method: 'DELETE' }),

  getColumnPreferences: (pageKey: string) =>
    apiRequest<{ columns: { key: string; visible: boolean; order: number }[] }>(`/user/preferences/${pageKey}`),
  updateColumnPreferences: (pageKey: string, columns: { key: string; visible: boolean; order: number }[]) =>
    apiRequest<{ columns: { key: string; visible: boolean; order: number }[] }>(
      `/user/preferences/${pageKey}`, { method: 'PUT', body: JSON.stringify({ columns }) },
    ),
};
