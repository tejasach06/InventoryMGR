import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { api } from '../api/client';
import type { DashboardStats, StorageArrayListItem, VmList } from '../api/client';
import { DashboardPage } from '../routes/DashboardPage';
import { renderWithProviders } from './utils';

const stats: DashboardStats = {
  total: 0, linux: 0, windows: 0, production: 0, development: 0,
  test_uat: 0, powered_off: 0, without_monitoring: 0, without_applications: 0,
  recently_added: [],
};
const emptyVms: VmList = { items: [], total: 0, limit: 200, offset: 0 };

function array(over: boolean, id: string): StorageArrayListItem {
  return {
    id, name: id, vendor: 'synology', datacenter: null, total_capacity_gb: 100,
    used_capacity_gb: over ? 90 : 10, used_pct: over ? 90 : 10, over_threshold: over,
    volume_count: 0, lun_count: 0, share_count: 0,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DashboardPage', () => {
  it('shows a storage-alerts tile with the over-threshold count linking to /storage', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(stats);
    vi.spyOn(api, 'listVms').mockResolvedValue(emptyVms);
    vi.spyOn(api, 'listArrays').mockResolvedValue([array(true, 'a1'), array(false, 'a2')]);
    renderWithProviders(<DashboardPage />);

    const tile = await screen.findByText('Storage alerts');
    const link = tile.closest('a');
    expect(link).toHaveAttribute('href', '/storage');
    expect(link).toHaveTextContent('1');
  });
});
