import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { StorageArray } from '../api/client';
import { StorageDetailPage } from '../routes/StorageDetailPage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'a1' }),
  useRouter: () => ({ push: hoisted.pushMock }),
}));

function makeArray(): StorageArray {
  return {
    id: 'a1', name: 'syn-01', vendor: 'synology', model: 'DS1821+', mgmt_host: null,
    datacenter: 'dc-east-1', description: null, total_capacity_gb: 1000, used_capacity_gb: 850,
    notes: null, used_pct: 85, over_threshold: true,
    created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
    volumes: [{
      id: 'v1', array_id: 'a1', name: 'vol1', capacity_gb: 500, used_gb: 250, notes: null,
      sort_order: 0, used_pct: 50, over_threshold: false,
      luns: [{ id: 'l1', volume_id: 'v1', name: 'lun0', size_gb: 100, used_gb: null, target_iqn: null, cluster: 'pve-a', status: null, sort_order: 0 }],
      shares: [{ id: 's1', volume_id: 'v1', export_path: '/vol1/share', used_gb: null, allowed_clients: null, notes: null, sort_order: 0 }],
    }],
  };
}

beforeEach(() => { hoisted.pushMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('StorageDetailPage', () => {
  it('renders array header, volume panel, and LUN + share rows', async () => {
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: ['pve-a'], os: [], os_by_family: { linux: [], windows: [] },
    });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'editor' }) });

    expect(await screen.findByRole('heading', { name: 'syn-01' })).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('vol1')).toBeInTheDocument();
    expect(screen.getByText('lun0')).toBeInTheDocument();
    expect(screen.getByText('/vol1/share')).toBeInTheDocument();
  });

  it('adding a LUN calls api.addLun', async () => {
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: ['pve-a'], os: [], os_by_family: { linux: [], windows: [] },
    });
    const addSpy = vi.spyOn(api, 'addLun').mockResolvedValue({
      id: 'l2', volume_id: 'v1', name: 'lun1', size_gb: 50, used_gb: null, target_iqn: null, cluster: null, status: null, sort_order: 1,
    });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'editor' }) });

    fireEvent.change(await screen.findByLabelText('LUN name'), { target: { value: 'lun1' } });
    fireEvent.change(screen.getByLabelText('Size GB'), { target: { value: '50' } });
    fireEvent.click(screen.getAllByRole('button', { name: /add/i })[0]);

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('v1', expect.objectContaining({ name: 'lun1', size_gb: 50 })));
  });

  it('hides add forms and delete buttons for viewers', async () => {
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
    });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findByRole('heading', { name: 'syn-01' });
    expect(screen.queryByLabelText('LUN name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete array/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove LUN lun0')).not.toBeInTheDocument();
  });

  it('deletes a LUN, share, volume, and the array (editor)', async () => {
    vi.stubGlobal('confirm', () => true);
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
    });
    const delLun = vi.spyOn(api, 'deleteLun').mockResolvedValue(null);
    const delShare = vi.spyOn(api, 'deleteShare').mockResolvedValue(null);
    const delVol = vi.spyOn(api, 'deleteVolume').mockResolvedValue(null);
    const delArr = vi.spyOn(api, 'deleteArray').mockResolvedValue(null);
    const addShare = vi.spyOn(api, 'addShare').mockResolvedValue({
      id: 's2', volume_id: 'v1', export_path: '/new', used_gb: null, allowed_clients: null, notes: null, sort_order: 1,
    });
    const addVolume = vi.spyOn(api, 'addVolume').mockResolvedValue({
      id: 'v2', array_id: 'a1', name: 'vol2', capacity_gb: 0, used_gb: 0, notes: null, sort_order: 1, used_pct: null, over_threshold: false, luns: [], shares: [],
    });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'editor' }) });

    fireEvent.click(await screen.findByLabelText('Remove LUN lun0'));
    fireEvent.click(screen.getByLabelText('Remove share /vol1/share'));
    fireEvent.click(screen.getByRole('button', { name: /delete volume/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete array/i }));

    fireEvent.change(screen.getByLabelText('Export path'), { target: { value: '/new' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^\+ add$/i })[1]);
    fireEvent.change(screen.getByLabelText('Volume name'), { target: { value: 'vol2' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^\+ add$/i })[2]);

    await waitFor(() => {
      expect(delLun).toHaveBeenCalledWith('v1', 'l1');
      expect(delShare).toHaveBeenCalledWith('v1', 's1');
      expect(delVol).toHaveBeenCalledWith('a1', 'v1');
      expect(delArr).toHaveBeenCalledWith('a1');
      expect(addShare).toHaveBeenCalledWith('v1', expect.objectContaining({ export_path: '/new' }));
      expect(addVolume).toHaveBeenCalledWith('a1', expect.objectContaining({ name: 'vol2' }));
    });
  });

  it('renders an empty-volumes message and an error state', async () => {
    const empty = { ...makeArray(), volumes: [] };
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
    });
    const getArray = vi.spyOn(api, 'getArray').mockResolvedValue(empty);
    const { unmount } = renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText('No volumes yet.')).toBeInTheDocument();
    unmount();

    getArray.mockRejectedValue(new Error('boom'));
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });
});
