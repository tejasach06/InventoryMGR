import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { PhysicalClusterListItem } from '../api/client';
import { ClustersPage } from '../routes/ClustersPage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hoisted.pushMock }) }));

beforeEach(() => { hoisted.pushMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function makeCluster(overrides: Partial<PhysicalClusterListItem> = {}): PhysicalClusterListItem {
  return {
    id: 'c1',
    name: 'pve-cluster-a',
    description: 'Primary DC cluster',
    node_count: 3,
    total_ram_gb: 384,
    total_storage_gb: 6000,
    ...overrides,
  };
}

describe('ClustersPage', () => {
  it('renders a cluster row with node count and totals', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([makeCluster()]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText('pve-cluster-a')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('384')).toBeInTheDocument();
    expect(screen.getByText('6000')).toBeInTheDocument();
  });

  it('shows an empty state when there are no clusters', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText(/no clusters yet/i)).toBeInTheDocument();
  });

  it('renders an error alert on failure', async () => {
    vi.spyOn(api, 'listClusters').mockRejectedValue(new Error('boom'));
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides the New cluster button for viewers', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    await waitFor(() => expect(api.listClusters).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /new cluster/i })).not.toBeInTheDocument();
  });

  it('creates a cluster and navigates to its detail page (editor)', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    const created = makeCluster();
    vi.spyOn(api, 'createCluster').mockResolvedValue({
      id: created.id, name: created.name, description: null, notes: null, nodes: [],
      created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
    });
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'editor' }) });
    fireEvent.click(await screen.findByRole('button', { name: /new cluster/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'pve-cluster-a' } });
    fireEvent.click(screen.getByRole('button', { name: /create cluster/i }));
    await waitFor(() => expect(api.createCluster).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pve-cluster-a' }),
    ));
    await waitFor(() => expect(hoisted.pushMock).toHaveBeenCalledWith('/clusters/c1'));
  });
});