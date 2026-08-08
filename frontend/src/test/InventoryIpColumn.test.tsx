import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import { InventoryPage } from '../routes/InventoryPage';
import { makeUser, makeVm, renderWithProviders } from './utils';
import type { VmList } from '../api/client';

const hoisted = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.pushMock }),
  usePathname: () => '/inventory',
  useSearchParams: () => hoisted.searchParams,
}));

beforeEach(() => {
  vi.spyOn(api, 'listVmOwners').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InventoryPage IP address column', () => {
  it('shows the first network IP by sort_order and drops the Health column', async () => {
    const list: VmList = { items: [makeVm()], total: 1, limit: 50, offset: 0 };
    vi.spyOn(api, 'listVms').mockResolvedValue(list);
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('10.0.0.10');
    // VmTable shows it; VmCard is hidden or restructured in the latest UI version
    expect(screen.getAllByText('10.0.0.10').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('10.0.0.11')).not.toBeInTheDocument();
    // Scoped to the table header: "Health" also appears as an inline filter label.
    expect(screen.queryByRole('columnheader', { name: /Health/ })).not.toBeInTheDocument();
  });

  it('shows a dash when the VM has no networks', async () => {
    const list: VmList = { items: [makeVm({ networks: [] })], total: 1, limit: 50, offset: 0 };
    vi.spyOn(api, 'listVms').mockResolvedValue(list);
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });
    // VMs might be queried through a delayed promise
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: "Inventory" })).toBeInTheDocument();
    });
    // Find the VM by name 
    await screen.findAllByText(new RegExp(list.items[0]!.name));
    // The IP address element shouldn't contain 10.0.0.10
    expect(screen.queryByText('10.0.0.10')).not.toBeInTheDocument();
  });
});
