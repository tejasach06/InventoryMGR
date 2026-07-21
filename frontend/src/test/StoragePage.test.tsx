import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { api } from '../api/client';
import type { StorageArrayListItem } from '../api/client';
import { StoragePage } from '../routes/StoragePage';
import { renderWithProviders } from './utils';

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
    renderWithProviders(<StoragePage />);

    const link = await screen.findByRole('link', { name: 'syn-01' });
    expect(link).toHaveAttribute('href', '/storage/a1');
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Over threshold')).toBeInTheDocument();
  });

  it('hides the threshold badge when the array is under threshold', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([
      makeArray({ used_pct: 40, over_threshold: false }),
    ]);
    renderWithProviders(<StoragePage />);

    await screen.findByRole('link', { name: 'syn-01' });
    expect(screen.queryByText('Over threshold')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no arrays', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<StoragePage />);

    expect(await screen.findByText('No storage arrays yet.')).toBeInTheDocument();
  });
});
