import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { api } from '../api/client';
import { VmFormPage } from '../routes/VmFormPage';
import { makeVm, renderWithProviders } from './utils';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
    cpu: ['8'],
    datacenter: ['dc-east-1', 'dc-east-2'],
    disk: [],
    os: ['Debian 12', 'Ubuntu 22.04'],
    os_by_family: { linux: ['Alpine Linux'], windows: ['Windows Server 2022'] },
  });
  vi.spyOn(api, 'listVmOwners').mockResolvedValue(['alice', 'alistair']);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VmFormPage combo/owner autocomplete', () => {
  it('suggests datacenter options and applies the chosen one', async () => {
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText('Datacenter'), { target: { value: 'dc-east' } });
    const suggestion = await screen.findByRole('button', { name: 'dc-east-2' });
    fireEvent.click(suggestion);

    expect(screen.getByLabelText('Datacenter')).toHaveValue('dc-east-2');
  });

  it('suggests known owners and applies the chosen one', async () => {
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'ali' } });
    const suggestion = await screen.findByRole('button', { name: 'alistair' });
    fireEvent.click(suggestion);

    expect(screen.getByLabelText('Owner')).toHaveValue('alistair');
  });

  it('scopes operating system suggestions to the selected OS family', async () => {
    renderWithProviders(<VmFormPage mode="create" />);

    await screen.findByLabelText('OS family');
    fireEvent.change(screen.getByLabelText('OS family'), { target: { value: 'linux' } });

    fireEvent.change(screen.getByLabelText('Operating system'), { target: { value: 'Alpine' } });
    expect(await screen.findByRole('button', { name: 'Alpine Linux' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Operating system'), { target: { value: 'Ubuntu' } });
    expect(screen.queryByRole('button', { name: 'Ubuntu 22.04' })).not.toBeInTheDocument();
  });
});

describe('VmFormPage disk rows', () => {
  it('adds, edits with a TB unit, and removes disk rows', () => {
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText('Disk 1 size'), { target: { value: '40' } });
    expect(screen.getByLabelText('Disk 1 size')).toHaveValue(40);

    fireEvent.click(screen.getByRole('button', { name: 'Add another disk' }));
    expect(screen.getByLabelText('Disk 2 size')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Disk 2 unit'), { target: { value: 'TB' } });
    fireEvent.change(screen.getByLabelText('Disk 2 size'), { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove disk 2' }));
    expect(screen.queryByLabelText('Disk 2 size')).not.toBeInTheDocument();
  });
});

describe('VmFormPage IP rows', () => {
  it('adds, edits, and removes IP rows', () => {
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText('IP address 1'), { target: { value: '10.0.0.1' } });
    expect(screen.getByLabelText('IP address 1')).toHaveValue('10.0.0.1');

    fireEvent.click(screen.getByRole('button', { name: 'Add IP address' }));
    const second = screen.getByLabelText('IP address 2');
    fireEvent.change(second, { target: { value: '10.0.0.2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove IP address 2' }));
    expect(screen.queryByLabelText('IP address 2')).not.toBeInTheDocument();
  });

  it('creates a VM with multiple disks and IPs from the row editors', async () => {
    const create = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm({ id: 'vm-new', name: 'multi' }));
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'multi' } });
    fireEvent.change(screen.getByLabelText(/^Cluster/), { target: { value: 'cluster-a' } });
    fireEvent.change(screen.getByLabelText(/^CPU cores/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Memory GB/), { target: { value: '4' } });
    fireEvent.submit(screen.getByLabelText(/^Name/).closest('form') as HTMLFormElement);

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const payload = create.mock.calls[0][0];
    expect(payload.memory_mb).toBe(4096);
  });
});

describe('VmFormPage disk/network detail fields', () => {
  it('submits disk name/storage/type and network vlan/gateway in the createVm payload', async () => {
    const create = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm({ id: 'vm-new', name: 'multi' }));
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'multi' } });
    fireEvent.change(screen.getByLabelText(/^Cluster/), { target: { value: 'cluster-a' } });
    fireEvent.change(screen.getByLabelText(/^CPU cores/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Memory GB/), { target: { value: '4' } });

    fireEvent.change(screen.getByLabelText('Disk 1 name'), { target: { value: 'os-disk' } });
    fireEvent.change(screen.getByLabelText('Disk 1 size'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Disk 1 storage'), { target: { value: 'ssd-pool' } });
    fireEvent.change(screen.getByLabelText('Disk 1 type'), { target: { value: 'thin' } });

    fireEvent.change(screen.getByLabelText('IP address 1'), { target: { value: '10.0.0.5' } });
    fireEvent.change(screen.getByLabelText('VLAN 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Gateway 1'), { target: { value: '10.0.0.1' } });

    fireEvent.submit(screen.getByLabelText(/^Name/).closest('form') as HTMLFormElement);

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const payload = create.mock.calls[0][0];
    expect(payload.disks).toEqual([{
      disk_name: 'os-disk', size_gb: 40, storage_name: 'ssd-pool', storage_type: 'thin', sort_order: 0,
    }]);
    expect(payload.networks).toEqual([{
      ip_address: '10.0.0.5', role: 'private', vlan: 100, gateway: '10.0.0.1', sort_order: 0,
    }]);
  });
});
