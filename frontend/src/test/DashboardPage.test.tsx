import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { api } from '../api/client';
import type { DashboardStats, StorageArrayListItem, VmList } from '../api/client';
import { DashboardPage } from '../routes/DashboardPage';
import { renderWithProviders } from './utils';

const stats: DashboardStats = {
  total: 0, linux: 0, windows: 0, production: 0, development: 0,
  test_uat: 0, powered_off: 0, without_monitoring: 0, without_applications: 0,
  shutdown_stale: [], decommission_overdue: [], missing_ip: [],
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

  it('renders alerts section with populated alert lists and correct view-all links', async () => {
    const statsWithAlerts: DashboardStats = {
      ...stats,
      shutdown_stale: [{ id: 'vm-1', name: 'stale-vm-1', environment: 'production', days: 95 }],
      decommission_overdue: [{ id: 'vm-2', name: 'overdue-vm-2', environment: 'development', days: 10 }],
      missing_ip: [{ id: 'vm-3', name: 'noip-vm-3', environment: 'testing', days: 0 }],
    };
    vi.spyOn(api, 'getDashboard').mockResolvedValue(statsWithAlerts);
    vi.spyOn(api, 'listVms').mockResolvedValue(emptyVms);
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('VM Alerts')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure status')).toBeInTheDocument();
    expect(screen.getByText('3 active')).toBeInTheDocument();

    expect(screen.getByText('Powered off > 90 days')).toBeInTheDocument();
    expect(screen.getByText('Past decommission date')).toBeInTheDocument();
    expect(screen.getByText('No IP address')).toBeInTheDocument();

    expect(screen.getByText('stale-vm-1')).toBeInTheDocument();
    expect(screen.getByText('95d shutdown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View stale shutdowns' })).toHaveAttribute('href', '/inventory?shutdown_stale=true');

    expect(screen.getByText('overdue-vm-2')).toBeInTheDocument();
    expect(screen.getByText('10d overdue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View overdue VMs' })).toHaveAttribute('href', '/inventory?decommission_overdue=true');

    expect(screen.getByText('noip-vm-3')).toBeInTheDocument();
    expect(screen.getByText('no IP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View VMs without IPs' })).toHaveAttribute('href', '/inventory?missing_ip=true');
  });

  it('renders overflow +N more line when group exceeds 5 rows', async () => {
    const manyShutdowns = Array.from({ length: 7 }, (_, i) => ({
      id: `vm-stale-${i}`, name: `stale-vm-${i}`, environment: 'production' as const, days: 100 + i,
    }));
    const statsWithOverflow: DashboardStats = {
      ...stats,
      shutdown_stale: manyShutdowns,
    };
    vi.spyOn(api, 'getDashboard').mockResolvedValue(statsWithOverflow);
    vi.spyOn(api, 'listVms').mockResolvedValue(emptyVms);
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('VM Alerts')).toBeInTheDocument();
    expect(screen.getByText('7 active')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.getByText('stale-vm-0')).toBeInTheDocument();
    expect(screen.getByText('stale-vm-4')).toBeInTheDocument();
    expect(screen.queryByText('stale-vm-5')).not.toBeInTheDocument();
  });

  it('renders all clear state when all alert lists are empty', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(stats);
    vi.spyOn(api, 'listVms').mockResolvedValue(emptyVms);
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('ALL IS WELL')).toBeInTheDocument();
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });
});
