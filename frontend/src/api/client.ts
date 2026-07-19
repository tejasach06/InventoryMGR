export type UserRole = 'admin' | 'editor' | 'viewer';
export type Platform = 'proxmox' | 'vmware';
export type VmStatus = 'running' | 'powered_off' | 'suspended' | 'archived' | 'decommissioned' | 'unknown';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';
export type Lifecycle = 'planned' | 'active' | 'retiring' | 'retired';
export type VmType = 'permanent' | 'temporary';
export type Environment = 'production' | 'development' | 'testing' | 'uat' | 'dr' | 'staging' | 'sandbox';
export type ImportAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid';
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

export type NetworkRole = 'private' | 'public' | 'backup';

export interface Network {
  id: string;
  vm_id: string;
  ip_address: string;
  role: NetworkRole;
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (isStateChanging(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('X-CSRF-Token', token);
  }


  try {
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

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
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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

  listVms: (params: URLSearchParams) => apiRequest<VmList>(`/vms?${params.toString()}`),
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
