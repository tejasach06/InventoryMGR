import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { CurrentUserProvider } from '../components/AuthContext';
import { ThemeProvider } from '../components/ThemeProvider';
import type { ImportBatch, ImportRow, User, Vm } from '../api/client';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions {
  user?: User;
  queryClient?: QueryClient;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const wrapped: ReactNode = options.user ? (
    <CurrentUserProvider user={options.user}>{ui}</CurrentUserProvider>
  ) : (
    ui
  );
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{wrapped}</QueryClientProvider>
    </ThemeProvider>,
  );
  return Object.assign(result, { queryClient });
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-admin',
    email: 'admin@example.local',
    role: 'admin',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

export function makeVm(overrides: Partial<Vm> = {}): Vm {
  return {
    id: 'vm-1',
    external_id: 'EXT-1',
    name: 'web-01',
    platform: 'proxmox',
    datacenter: 'dc-1',
    sr_id: 'SR-1',
    cluster: 'cluster-a',
    status: 'running',
    cpu_cores: 4,
    memory_mb: 8192,
    disk_gb: [40, 100],
    os_name: 'Debian 12',
    os_family: 'linux',
    ip_addresses: ['10.0.0.10', '10.0.0.11'],
    owner: 'alice',
    notes: 'primary web node',
    backup_enabled: true,
    ha_enabled: true,
    criticality: 'high',
    lifecycle: 'active',
    tags: ['web', 'prod'],
    last_verified_at: '2024-03-01',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-03-02T12:00:00Z',
    ...overrides,
  };
}

export function makeImportRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id: 'row-1',
    row_number: 2,
    raw: {},
    normalized: { name: 'web-01' },
    action: 'create',
    target_vm_id: null,
    errors: [],
    ...overrides,
  };
}

export function makeImportBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'batch-1',
    filename: 'vms.csv',
    status: 'previewed',
    summary: { create: 1, update: 0, conflict: 0, invalid: 0 },
    rows: [makeImportRow()],
    created_at: '2024-03-01T00:00:00Z',
    committed_at: null,
    ...overrides,
  };
}
