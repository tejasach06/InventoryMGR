import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { ApiError } from '../api/core';
import { dashboard as dashboardApi } from '../api/dashboard';
import { ReportsPage } from '../routes/ReportsPage';
import { renderWithProviders } from './utils';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ReportsPage', () => {
  it('renders server summary counts, progress labels, and download links', async () => {
    vi.spyOn(dashboardApi, 'getReportSummary').mockResolvedValue({
      total_vms: 10,
      counts: { linux: 6, windows: 4, owner: 3, monitoring: 8 },
    });

    renderWithProviders(<ReportsPage />);

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export all VMs/ })).toHaveAttribute('href', '/api/vms/export?all=true');
    expect(screen.getByText('Linux Inventory')).toBeInTheDocument();
    expect(screen.getByText('Windows Inventory')).toBeInTheDocument();
    expect(await screen.findByText('10 VMs across 8 report views')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Distinct count')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Linux Inventory: 6 of 10 VMs' })).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getAllByRole('link', { name: /Download/ })[0]).toHaveAttribute('href', '/api/reports/linux?format=csv');
  });

  it('shows the empty state once an empty report summary loads', async () => {
    vi.spyOn(dashboardApi, 'getReportSummary').mockResolvedValue({ total_vms: 0, counts: {} });

    renderWithProviders(<ReportsPage />);

    expect(await screen.findByText('No VMs to report on')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to inventory' })).toHaveAttribute('href', '/inventory');
  });

  it('renders loading placeholders and reports query errors', async () => {
    vi.spyOn(dashboardApi, 'getReportSummary').mockRejectedValue(new ApiError(500, 'Summary unavailable'));

    renderWithProviders(<ReportsPage />);

    expect(screen.getByText('loading…')).toBeInTheDocument();
    expect(await screen.findByText('Summary unavailable')).toBeInTheDocument();
  });
});
