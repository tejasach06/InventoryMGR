import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { StorageArray, StorageArrayListItem } from '../api/client';
import { StoragePage } from '../routes/StoragePage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hoisted.pushMock }) }));

beforeEach(() => { hoisted.pushMock.mockReset(); });

function makeArray(overrides: Partial<StorageArrayListItem> = {}): StorageArrayListItem {
  return {
    id: 'a1',
    name: 'syn-01',
    vendor: 'synology',
    datacenter: 'dc-east-1',
    total_capacity_gb: 1000,
    used_capacity_gb: 850,
    used_pct: 85,
    over_threshold: true,
    volume_count: 2,
    lun_count: 3,
    share_count: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StoragePage', () => {
  it('renders an array row with usage and an over-threshold badge linking to detail', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([makeArray()]);
    renderWithProviders(<StoragePage />, { user: makeUser() });

    const link = await screen.findByRole('link', { name: 'syn-01' });
    expect(link).toHaveAttribute('href', '/storage/a1');
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Over threshold')).toBeInTheDocument();
  });

  it('hides the threshold badge when the array is under threshold', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([
      makeArray({ used_pct: 40, over_threshold: false }),
    ]);
    renderWithProviders(<StoragePage />, { user: makeUser() });

    await screen.findByRole('link', { name: 'syn-01' });
    expect(screen.queryByText('Over threshold')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no arrays', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<StoragePage />, { user: makeUser() });

    expect(await screen.findByText('No storage arrays yet.')).toBeInTheDocument();
  });

  it('renders a dash for null usage and an error alert on failure', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([
      makeArray({ used_pct: null, over_threshold: false, datacenter: null }),
    ]);
    const { unmount } = renderWithProviders(<StoragePage />, { user: makeUser() });
    await screen.findByRole('link', { name: 'syn-01' });
    unmount();

    vi.spyOn(api, 'listArrays').mockRejectedValue(new Error('kaboom'));
    renderWithProviders(<StoragePage />, { user: makeUser() });
    expect(await screen.findByText(/kaboom/i)).toBeInTheDocument();
  });

  it('hides the New array button for viewers', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<StoragePage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByText('No storage arrays yet.');
    expect(screen.queryByRole('button', { name: /new array/i })).not.toBeInTheDocument();
  });

  it('creates an array and navigates to its detail page (editor)', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    const created: StorageArray = {
      id: 'a9', name: 'syn-09', vendor: 'synology', model: null, mgmt_host: null,
      datacenter: null, description: null, total_capacity_gb: 500, used_capacity_gb: 0,
      notes: null, used_pct: 0, over_threshold: false,
      created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z', volumes: [],
    };
    const createSpy = vi.spyOn(api, 'createArray').mockResolvedValue(created);
    renderWithProviders(<StoragePage />, { user: makeUser({ role: 'editor' }) });

    fireEvent.click(await screen.findByRole('button', { name: /new array/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'syn-09' } });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'synology' } });
    fireEvent.change(screen.getByLabelText('Total capacity (GB)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /^create array$/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'syn-09', vendor: 'synology', total_capacity_gb: 500 }),
      );
      expect(hoisted.pushMock).toHaveBeenCalledWith('/storage/a9');
    });
  });
});
