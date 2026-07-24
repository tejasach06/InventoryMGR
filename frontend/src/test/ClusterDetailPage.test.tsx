import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { PhysicalCluster } from '../api/client';
import { ClusterDetailPage } from '../routes/ClusterDetailPage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: hoisted.pushMock }),
}));

function makeCluster(): PhysicalCluster {
  return {
    id: 'c1', name: 'pve-cluster-a', description: 'primary DC', notes: null,
    created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
    nodes: [{
      id: 'n1', cluster_id: 'c1', name: 'node-01', cpu_model: 'Xeon E5-2680 v4',
      cpu_cores: 16, cpu_threads: 32, ram_total_gb: 128, ram_used_gb: 64,
      storage_usable_gb: 2000, datacenter: 'dc-east-1', rack: 'Rack 12', rack_unit: 'U4',
      ip_addresses: [{ label: 'mgmt', address: '10.0.1.5' }], notes: null, sort_order: 0,
    }],
  };
}

beforeEach(() => { hoisted.pushMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ClusterDetailPage', () => {
  it('renders cluster header and node row', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText('pve-cluster-a')).toBeInTheDocument();
    expect(screen.getByText('node-01')).toBeInTheDocument();
    expect(screen.getByText('mgmt 10.0.1.5')).toBeInTheDocument();
    expect(screen.getByText('64 / 128 GB')).toBeInTheDocument();
  });

  it('adding a node calls api.addNode', async () => {
    const cluster = makeCluster();
    vi.spyOn(api, 'getCluster').mockResolvedValue(cluster);
    vi.spyOn(api, 'addNode').mockResolvedValue(cluster.nodes[0]);
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    fireEvent.change(screen.getByLabelText(/^node name$/i), { target: { value: 'node-02' } });
    fireEvent.click(screen.getByRole('button', { name: /^\+ add node$/i }));
    await waitFor(() => expect(api.addNode).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'node-02' })));
  });

  it('hides add form and delete buttons for viewers', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByText('pve-cluster-a');
    expect(screen.queryByLabelText(/^node name$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove node/i })).not.toBeInTheDocument();
  });

  it('deletes a node and the cluster (editor)', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    vi.spyOn(api, 'deleteNode').mockResolvedValue(null);
    vi.spyOn(api, 'deleteCluster').mockResolvedValue(null);
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.click(screen.getByRole('button', { name: /remove node node-01/i }));
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('c1', 'n1'));
    fireEvent.click(screen.getByRole('button', { name: /delete cluster/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteCluster).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(hoisted.pushMock).toHaveBeenCalledWith('/clusters'));
  });

  it('edits the cluster and calls api.updateCluster (editor)', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    vi.spyOn(api, 'updateCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'pve-cluster-a2' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.updateCluster).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'pve-cluster-a2' })));
  });

  it('renders an empty-nodes message and an error state', async () => {
    vi.spyOn(api, 'getCluster').mockRejectedValueOnce(new Error('boom'));
    const { unmount } = renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    unmount();

    vi.spyOn(api, 'getCluster').mockResolvedValue({ ...makeCluster(), nodes: [] });
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText(/no nodes yet/i)).toBeInTheDocument();
  });
});