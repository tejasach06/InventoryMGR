export type UserRole = 'admin' | 'editor' | 'viewer';
export type Platform = 'proxmox' | 'vmware';
export type VmStatus = 'running' | 'stopped' | 'suspended' | 'unknown';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';
export type Lifecycle = 'planned' | 'active' | 'retiring' | 'retired';
export type ImportAction = 'create' | 'update' | 'conflict' | 'invalid';

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

export interface Vm {
  id: string;
  external_id: string | null;
  name: string;
  platform: Platform;
  environment: string;
  datacenter: string | null;
  cluster: string;
  host: string;
  status: VmStatus;
  cpu_cores: number;
  memory_mb: number;
  disk_gb: number;
  os_name: string | null;
  ip_addresses: string[];
  owner: string | null;
  notes: string | null;
  backup_status: string | null;
  ha_enabled: boolean;
  dr_tier: string | null;
  criticality: Criticality;
  lifecycle: Lifecycle;
  tags: string[];
  last_verified_at: string | null;
  created_by_id?: string;
  updated_by_id?: string;
  created_at: string;
  updated_at: string;
}

export type VmPayload = Omit<Vm, 'id' | 'created_by_id' | 'updated_by_id' | 'created_at' | 'updated_at'>;

export interface VmList {
  items: Vm[];
  total: number;
  limit: number;
  offset: number;
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

export interface MempalaceSearchHit {
  title: string;
  path: string;
  page_type: string | null;
  line: number;
  snippet: string;
}

export interface MempalaceSearchResult {
  query: string;
  total: number;
  items: MempalaceSearchHit[];
}

const API_PREFIX = '/api';
const CSRF_COOKIE = 'inventorymgr_csrf';

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      return decodeURIComponent(value.slice(prefix.length));
    }
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
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (isStateChanging(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) {
      headers.set('X-CSRF-Token', token);
    }
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
  });
  const data = await parseResponse(response);

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data ? (data as { detail: unknown }).detail : data;
    throw new ApiError(response.status, detail);
  }

  return data as T;
}

export function detailMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.detail === 'string') return error.detail;
    if (Array.isArray(error.detail)) {
      return error.detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg);
          return 'Request validation failed';
        })
        .join('; ');
    }
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

export const api = {
  setupStatus: () => apiRequest<SetupStatus>('/auth/setup'),
  setupAdmin: (email: string, password: string) =>
    apiRequest<{ user: User }>('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => apiRequest<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
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
  updateVm: (id: string, payload: Partial<VmPayload>) => apiRequest<Vm>(`/vms/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVm: (id: string) => apiRequest<null>(`/vms/${id}`, { method: 'DELETE' }),
  previewImport: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return apiRequest<ImportBatch>('/imports/preview', { method: 'POST', body });
  },
  getImport: (id: string) => apiRequest<ImportBatch>(`/imports/${id}`),
  commitImport: (id: string) => apiRequest<CommitResult>(`/imports/${id}/commit`, { method: 'POST' }),
  searchMempalace: (params: URLSearchParams) => apiRequest<MempalaceSearchResult>(`/mempalace/search?${params.toString()}`),
};
