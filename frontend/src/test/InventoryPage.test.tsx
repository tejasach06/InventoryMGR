import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vms as vmsApi } from '../api/vms';
import { ApiError } from '../api/core';
import type { VmList } from '../api/types';
import { InventoryPage } from '../routes/InventoryPage';
import { makeUser, makeVm, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({
  pushMock: vi.fn((url: string) => {
    const query = url.includes('?') ? url.split('?')[1] : '';
    hoisted.searchParams = new URLSearchParams(query);
  }),
  replaceMock: vi.fn((url: string) => {
    const query = url.includes('?') ? url.split('?')[1] : '';
    hoisted.searchParams = new URLSearchParams(query);
  }),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.pushMock, replace: hoisted.replaceMock }),
  usePathname: () => '/inventory',
  useSearchParams: () => hoisted.searchParams,
}));

function makeVmList(overrides: Partial<VmList> = {}): VmList {
  return { items: [makeVm()], total: 1, limit: 50, offset: 0, ...overrides };
}

beforeEach(() => {
  hoisted.searchParams = new URLSearchParams();
  hoisted.pushMock.mockClear();
  hoisted.replaceMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InventoryPage', () => {
  it('renders a single VM in both the table and the card', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    // The same VM name renders once in the desktop table and once in the mobile card.
    const names = await screen.findAllByText('web-01');
    expect(names).toHaveLength(2);
    expect(screen.queryByText('No VMs yet')).not.toBeInTheDocument();
  });

  it('reflects the total in the count when multiple VMs are returned', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm(), makeVm({ id: 'vm-2', name: 'db-02' })], total: 2 }),
    );
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    expect(await screen.findAllByText('web-01')).toHaveLength(2);
    expect(screen.getAllByText('db-02')).toHaveLength(2);
  });

  it('does not render the redundant quick-stat tiles', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findAllByText('web-01');
    expect(screen.queryByText('Total VMs')).not.toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg Health')).not.toBeInTheDocument();
  });

  it('renders no context panel and shows bulk actions when rows are selected', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findAllByText('web-01');
    expect(screen.queryByLabelText('Inventory context panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet Pulse')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing previewed')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select web-01' }));
    expect(await screen.findByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();
  });

  it('has no Actions column in the table', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('web-01');
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View details')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
  });

  it('renders status, criticality, and platform badges with semantic color', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findAllByText('web-01');
    const status = screen.getByTestId('cell-status');
    expect(status.querySelector('span[style*="--color-status"]')).not.toBeNull();

    const criticality = screen.getByTestId('cell-criticality');
    expect(criticality.querySelector('span[style*="--color-criticality"]')).not.toBeNull();

    const platform = screen.getByTestId('cell-platform');
    expect(platform.querySelector('span[style*="--color-platform"]')).not.toBeNull();
  });

  it('shows the empty state when no VMs match', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    expect(await screen.findByText('No VMs yet')).toBeInTheDocument();
  });

  it('shows the loading skeleton while the query is pending', () => {
    vi.spyOn(vmsApi, 'listVms').mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    // TableSkeleton renders a table with skeleton rows
    expect(screen.getByRole('table', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('shows an Alert with the error detail when the query rejects', async () => {
    vi.spyOn(vmsApi, 'listVms').mockRejectedValue(new ApiError(500, 'boom'));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('boom');
  });

  it('shows the "New VM" link for editors', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'editor' }) });

    await screen.findByText('No VMs yet');
    expect(screen.getByRole('link', { name: 'New VM' })).toHaveAttribute('href', '/inventory/new');
  });

  it('hides the "New VM" link for viewers', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findByText('No VMs yet');
    expect(screen.queryByRole('link', { name: 'New VM' })).not.toBeInTheDocument();
  });
  it('clears a typed search term from the search field itself, not "Clear all"', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByText('No VMs yet');
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    const search = screen.getByRole('searchbox', { name: 'Search VMs' });
    await user.type(search, 'web');

    // Search is not a facet: it never raises the chip row's "Clear all".
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toHaveValue(''));
  });
  it('uses router.replace instead of push for search filter changes', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('web-01');
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search VMs' }), 'web');

    await waitFor(() => expect(hoisted.replaceMock).toHaveBeenLastCalledWith('/inventory?q=web'));
    expect(hoisted.pushMock).not.toHaveBeenCalled();
  });

  it('seeds the search field from the URL and clears it back to empty', async () => {
    hoisted.searchParams = new URLSearchParams('q=web');
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('web-01');
    // filtersFromParams seeds the search field from the URL.
    expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toHaveValue('web');

    hoisted.pushMock.mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toHaveValue(''));
  });
  it('requests the second page with limit and offset', async () => {
    // listVms mock resolves { items, total: 120, limit: 50, offset: 0 }
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ total: 120 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Next page' }));

    const lastCall = vi.mocked(vmsApi.listVms).mock.calls.at(-1)![0];
    expect(lastCall.get('limit')).toBe('50');
    expect(lastCall.get('offset')).toBe('50');
  });

  it('sends sort and dir when a sortable column header is clicked', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    await userEvent.click(await screen.findByRole('button', { name: /Name/ }));

    const lastCall = vi.mocked(vmsApi.listVms).mock.calls.at(-1)![0];
    expect(lastCall.get('sort')).toBe('name');
    expect(lastCall.get('dir')).toBe('asc');
  });
  it('renders Export CSV and Export Excel links', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByRole('button', { name: 'Filters' });
    await userEvent.setup().click(screen.getByText('Export'));
    const csvLink = screen.getByRole('link', { name: 'CSV' });
    const excelLink = screen.getByRole('link', { name: 'Excel' });
    expect(csvLink).toHaveAttribute('href', expect.stringContaining('/api/vms/export'));
    expect(excelLink).toHaveAttribute('href', expect.stringContaining('format=xlsx'));
  });
  it('sends ids when editing a page selection', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 1 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({ updated: 1, failed: [] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select vm-01'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to 1 VM$/ }));

    expect(vi.mocked(vmsApi.bulkUpdateVms)).toHaveBeenCalledWith({
      ids: ['vm-01-id'],
      patch: { status: 'running' },
    });
  });

  it('sends filters after selecting everything matching', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 120 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({ updated: 120, failed: [] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select all'));
    await userEvent.click(screen.getByRole('button', { name: /Select all .* matching filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'high');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to all/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Edit' }));

    const body = vi.mocked(vmsApi.bulkUpdateVms).mock.calls.at(-1)![0];
    expect(body.ids).toBeUndefined();
    expect(body.patch).toEqual({ criticality: 'high' });
  });

  it('renders bulk error alert when bulk update has failures', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 1 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({
      updated: 0,
      failed: [{ id: 'vm-01-id', message: 'Update failed' }],
    });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select vm-01'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to 1 VM$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('0 updated, 1 failed');
  });
  it('presents confirmation modal before executing bulk edits on matching filters', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 50 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({ updated: 50, failed: [] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select all'));
    await userEvent.click(screen.getByRole('button', { name: /Select all .* matching filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'decommissioned');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to all/ }));

    expect(screen.getByRole('heading', { name: 'Confirm Bulk Update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Bulk Edit' })).toBeInTheDocument();
    expect(vmsApi.bulkUpdateVms).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Edit' }));
    expect(vmsApi.bulkUpdateVms).toHaveBeenCalledTimes(1);
  });


  it('preserves repeated filters while converting page and size to API limit and offset', async () => {
    hoisted.searchParams = new URLSearchParams(
      'q=database&status=running&status=powered_off&page=2&size=25&sort=name&dir=desc',
    );
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ total: 100, limit: 25, offset: 25 }));

    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findAllByText('web-01');
    const params = vi.mocked(vmsApi.listVms).mock.calls.at(-1)![0];
    expect(params.get('q')).toBe('database');
    expect(params.getAll('status')).toEqual(['running', 'powered_off']);
    expect(params.get('sort')).toBe('name');
    expect(params.get('dir')).toBe('desc');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('25');
    expect(params.has('page')).toBe(false);
    expect(params.has('size')).toBe(false);
  });

  it('cycles a sortable header from ascending to descending to unsorted URLs', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    const nameHeader = await screen.findByRole('button', { name: /Name/ });

    await userEvent.click(nameHeader);
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory?sort=name&dir=asc');
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory?sort=name&dir=desc');
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory');
  });

  it('sends a scalar search and repeated facet arrays when bulk editing all matches', async () => {
    hoisted.searchParams = new URLSearchParams(
      'q=database&status=running&status=powered_off&environment=production',
    );
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 50 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({ updated: 50, failed: [] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select all'));
    await userEvent.click(screen.getByRole('button', { name: /Select all .* matching filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'high');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to all/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Edit' }));

    expect(vi.mocked(vmsApi.bulkUpdateVms)).toHaveBeenCalledWith({
      filters: {
        q: 'database',
        status: ['running', 'powered_off'],
        environment: ['production'],
      },
      patch: { criticality: 'high' },
    });
  });

  it('keeps table selection and sorting controls accessibly named and scoped', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    const nameButton = await screen.findByRole('button', { name: /Name/ });
    const nameHeader = nameButton.closest('th');
    expect(nameHeader).toHaveAttribute('scope', 'col');
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select web-01' })).toBeInTheDocument();
  });

  it('renders an alert with API detail when an inline cell edit fails', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    vi.spyOn(vmsApi, 'updateVm').mockRejectedValue(new ApiError(400, 'Status update rejected'));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('cell-status'));
    const editor = screen.getByRole('combobox');
    await user.selectOptions(editor, 'powered_off');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Status update rejected');
  });

  it('commits an inline status edit with Enter and sends the existing PATCH shape', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(makeVm({ status: 'powered_off' }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    const user = userEvent.setup();
    const statusCell = await screen.findByTestId('cell-status');
    await user.click(statusCell);
    const editor = screen.getByRole('combobox');
    await user.selectOptions(editor, 'powered_off');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(vmsApi.updateVm).toHaveBeenCalledWith('vm-1', { status: 'powered_off' });
    });
  });
});
