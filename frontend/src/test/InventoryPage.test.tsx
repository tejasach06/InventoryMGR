import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InventoryPage bulk deletion', () => {
  async function selectVm(role: 'admin' | 'editor' | 'viewer' = 'admin') {
    const inventory = vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ total: 2 }));
    const { queryClient } = renderWithProviders(<InventoryPage />, { user: makeUser({ role }) });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select web-01' }));
    return { inventory, queryClient };
  }

  async function openDelete() {
    const inventory = await selectVm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete 1 selected VM?');
    expect(dialog).toHaveAccessibleDescription(/permanently deletes these records from InventoryMGR only/i);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    const hold = within(dialog).getByRole('button', { name: 'Hold to delete' });
    vi.useFakeTimers();
    return { ...inventory, dialog, cancel, hold };
  }

  it.each(['editor', 'viewer'] as const)('hides delete for %ss', async (role) => {
    await selectVm(role);
    expect(screen.queryByRole('button', { name: 'Delete selected' })).not.toBeInTheDocument();
  });

  it('hides delete when all matching VMs are selected', async () => {
    await selectVm();
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching filters' }));
    expect(screen.queryByRole('button', { name: 'Delete selected' })).not.toBeInTheDocument();
  });

  it('only stages checked VMs still present on the current page', async () => {
    const database = makeVm({ id: 'vm-2', name: 'db-02' });
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ items: [makeVm(), database], total: 2 }));
    const { queryClient } = renderWithProviders(<InventoryPage />, { user: makeUser() });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    act(() => {
      queryClient.setQueriesData<VmList>({ queryKey: ['vms'] }, makeVmList({ items: [database] }));
    });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Select web-01' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete 1 selected VM?' });
    expect(within(dialog).getByRole('list')).toHaveTextContent('db-02');
    expect(within(dialog).getByRole('list')).not.toHaveTextContent('web-01');
  });

  it('submits the frozen IDs once at two seconds and keeps the dialog open while pending', async () => {
    let resolveDelete: (value: null) => void = () => { throw new Error('Deletion was not requested'); };
    const deletion = vi.spyOn(vmsApi, 'bulkDeleteVms').mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    const { queryClient, inventory, dialog, cancel, hold } = await openDelete();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => {
      queryClient.setQueriesData<VmList>({ queryKey: ['vms'] }, makeVmList({ items: [makeVm({ id: 'new-id', name: 'new-name' })] }));
    });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(within(dialog).getByRole('list')).toHaveTextContent('web-01');
    expect(within(dialog).getByRole('list')).not.toHaveTextContent('new-name');

    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(deletion).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(deletion).toHaveBeenCalledExactlyOnceWith(['vm-1']);

    fireEvent.keyDown(hold, { key: 'Enter', repeat: true });
    fireEvent.keyDown(hold, { key: 'Escape' });
    fireEvent.click(cancel);
    fireEvent.click(dialog.children[0]);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(deletion).toHaveBeenCalledTimes(1);
    expect(cancel).toBeDisabled();
    expect(dialog).toBeInTheDocument();

    inventory.mockResolvedValue(makeVmList({ items: [], total: 0 }));
    await act(async () => resolveDelete(null));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
    expect(screen.getByText('Deleted 1 VM record.')).toBeInTheDocument();
    for (const key of ['vms', 'vm-owners', 'vm-suggestions', 'vm-clusters', 'vm-nodes', 'vm-tags']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it('cancels an interrupted hold and requires a fresh two seconds after an error', async () => {
    const deletion = vi.spyOn(vmsApi, 'bulkDeleteVms')
      .mockRejectedValueOnce(new ApiError(500, 'Deletion failed.'))
      .mockRejectedValueOnce(new ApiError(409, 'Selection changed.'));
    const { hold, dialog, inventory } = await openDelete();
    const pointer = { pointerId: 1, button: 0, isPrimary: true, pointerType: 'touch' };
    fireEvent.click(hold);
    for (const interrupt of [
      () => fireEvent.pointerUp(hold, pointer),
      () => fireEvent.pointerLeave(hold, pointer),
      () => fireEvent.pointerCancel(hold, pointer),
      () => fireEvent.blur(window),
    ]) {
      fireEvent.pointerDown(hold, pointer);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      interrupt();
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(deletion).not.toHaveBeenCalled();
    }

    fireEvent.pointerDown(hold, pointer);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    fireEvent.pointerUp(hold, pointer);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Deletion failed.');

    fireEvent.click(hold);
    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: ' ' });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(deletion).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
    expect(screen.getByText(/the selection is stale/i)).toBeInTheDocument();
    expect(inventory).toHaveBeenCalledTimes(2);
  });

  it('cancels a keyboard hold on release, focus loss, or dismissal', async () => {
    const deletion = vi.spyOn(vmsApi, 'bulkDeleteVms').mockResolvedValue(null);
    const { hold, dialog, cancel } = await openDelete();
    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: ' ' });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    fireEvent.keyUp(hold, { key: ' ' });
    fireEvent.keyDown(hold, { key: 'Enter' });
    act(() => cancel.focus());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(deletion).not.toHaveBeenCalled();

    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: 'Enter' });
    fireEvent.keyDown(hold, { key: 'Escape' });
    expect(dialog).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(deletion).not.toHaveBeenCalled();
  });
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

  it('corrects page boundary to lastPage with router.replace when result set shrinks', async () => {
    hoisted.searchParams = new URLSearchParams('page=5');
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ total: 10 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await waitFor(() => {
      expect(hoisted.replaceMock).toHaveBeenCalledWith('/inventory');
    });
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
  it('opens the export drawer, previews with list columns and drops a deselected column', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 1 }),
    );
    const preview = vi.spyOn(vmsApi, 'exportPreview').mockResolvedValue({ total: 1, columns: ['name'], rows: [['vm-01']] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    await userEvent.click(await screen.findByLabelText('Select vm-01'));
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Export' }));

    expect(await screen.findByText(/Preview — 1 VM/)).toBeInTheDocument();
    const first = preview.mock.calls[0][0];
    expect(first.getAll('ids')).toEqual(['vm-01-id']);
    expect(first.get('columns')).toContain('cpu_cores,memory_mb');
    expect(first.get('format')).toBe('json');

    const dialog = screen.getByRole('dialog', { name: 'Export VMs' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Name' }));
    expect(preview.mock.calls.at(-1)![0].get('columns')).not.toMatch(/^name|,name/);
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
