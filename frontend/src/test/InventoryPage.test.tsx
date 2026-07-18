import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../api/client';
import type { VmList } from '../api/client';
import { InventoryPage } from '../routes/InventoryPage';
import { makeUser, makeVm, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.pushMock }),
  usePathname: () => '/inventory',
  useSearchParams: () => hoisted.searchParams,
}));

function makeVmList(overrides: Partial<VmList> = {}): VmList {
  return { items: [makeVm()], total: 1, limit: 50, offset: 0, ...overrides };
}

beforeEach(() => {
  hoisted.pushMock.mockReset();
  hoisted.searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InventoryPage', () => {
  it('renders a single VM in both the table and the card with a "1 of 1 shown" count', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    // The same VM name renders once in the desktop table and once in the mobile card.
    const names = await screen.findAllByText('web-01');
    expect(names).toHaveLength(2);
    expect(screen.getByText('1 of 1 shown')).toBeInTheDocument();
    expect(screen.queryByText('No VMs yet')).not.toBeInTheDocument();
  });

  it('reflects the total in the count when multiple VMs are returned', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm(), makeVm({ id: 'vm-2', name: 'db-02' })], total: 2 }),
    );
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    expect(await screen.findByText('2 of 2 shown')).toBeInTheDocument();
    expect(screen.getAllByText('web-01')).toHaveLength(2);
    expect(screen.getAllByText('db-02')).toHaveLength(2);
  });

  it('does not render the redundant quick-stat tiles', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    expect(await screen.findByText('1 of 1 shown')).toBeInTheDocument();
    expect(screen.queryByText('Total VMs')).not.toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg Health')).not.toBeInTheDocument();
  });

  it('renders no context panel and shows bulk actions when rows are selected', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findByText('1 of 1 shown');
    expect(screen.queryByLabelText('Inventory context panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet Pulse')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing previewed')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select web-01' }));
    expect(await screen.findByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();
  });

  it('shows the empty state when no VMs match', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    expect(await screen.findByText('No VMs yet')).toBeInTheDocument();
    expect(screen.queryByText('1 of 1 shown')).not.toBeInTheDocument();
  });

  it('shows the loading skeleton while the query is pending', () => {
    vi.spyOn(api, 'listVms').mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    // TableSkeleton renders a table with skeleton rows
    expect(screen.getByRole('table', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('shows an Alert with the error detail when the query rejects', async () => {
    vi.spyOn(api, 'listVms').mockRejectedValue(new ApiError(500, 'boom'));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('boom');
  });

  it('shows the "New VM" link for editors', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'editor' }) });

    await screen.findByText('No VMs yet');
    expect(screen.getByRole('link', { name: 'New VM' })).toHaveAttribute('href', '/inventory/new');
  });

  it('hides the "New VM" link for viewers', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findByText('No VMs yet');
    expect(screen.queryByRole('link', { name: 'New VM' })).not.toBeInTheDocument();
  });
  it('clears a typed search term from the search field itself, not "Clear all"', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
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
  it('seeds the search field from the URL and clears it back to empty', async () => {
    hoisted.searchParams = new URLSearchParams('q=web');
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('web-01');
    // filtersFromParams seeds the search field from the URL.
    expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toHaveValue('web');

    hoisted.pushMock.mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toHaveValue(''));
  });
});
