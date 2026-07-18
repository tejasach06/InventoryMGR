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
  it('reveals "Clear all" after typing a search term and pushes the pathname on clear', async () => {
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList({ items: [], total: 0 }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByText('No VMs yet');
    // No active filter on mount -> the clear control is absent.
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search…'), 'web');

    const clear = screen.getByRole('button', { name: 'Clear all' });
    await user.click(clear);

    // Verify the search input is cleared
    await waitFor(() => expect(screen.getByPlaceholderText('Search…')).toHaveValue(''));
    // Clear button should disappear after clearing
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument());
  });
  it('renders an active filter from the URL and clears it back to the pathname', async () => {
    hoisted.searchParams = new URLSearchParams('q=web');
    vi.spyOn(api, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findAllByText('web-01');
    // filtersFromParams seeds the search field from the URL.
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('web');
    const clear = screen.getByRole('button', { name: 'Clear all' });

    hoisted.pushMock.mockClear();
    const user = userEvent.setup();
    await user.click(clear);

    // Verify the search input is cleared
    await waitFor(() => expect(screen.getByPlaceholderText('Search…')).toHaveValue(''));
  });
});
