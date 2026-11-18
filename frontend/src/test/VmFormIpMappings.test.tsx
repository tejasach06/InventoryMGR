import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VmFormPage } from '../routes/VmFormPage';
import { vms as vmsApi } from '../api/vms';
import { makeVm, renderWithProviders } from './utils';
import { settings as settingsApi } from '../api/settings';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'vm-1' }),
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(settingsApi, 'getDropdownOptions').mockResolvedValue({
    cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
  });
  vi.spyOn(vmsApi, 'listVmOwners').mockResolvedValue([]);
  vi.spyOn(vmsApi, 'listVmSuggestions').mockResolvedValue({});
  vi.spyOn(vmsApi, 'listVmClusters').mockResolvedValue([]);
  vi.spyOn(vmsApi, 'listVmNodes').mockResolvedValue([]);
  vi.spyOn(vmsApi, 'listVmTags').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VmFormPage - IP Mappings', () => {
  it('loads a legacy unmapped VM without errors and shows unmapped options', async () => {
    const legacyVm = makeVm({
      ip_mappings: undefined,
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
      ],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(legacyVm);

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${legacyVm.name}` });

    expect(screen.getByTestId('ip-mappings-section')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.1');
    expect(checkbox).not.toBeChecked();
  });

  it('handles manual save and reopen flow with IP mappings', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
      ],
      ip_mappings: [],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(vmsApi, 'updateVm').mockResolvedValue({
      ...vm,
      ip_mappings: [{ public_ip: '203.0.113.1', private_ip: '10.0.0.1' }],
    });

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    const checkbox = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.1');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][1];
    expect(payload.ip_mappings).toEqual([
      { public_ip: '203.0.113.1', private_ip: '10.0.0.1' },
    ]);

    cleanup();

    // Reopen flow: load with saved mapping
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue({
      ...vm,
      ip_mappings: [{ public_ip: '203.0.113.1', private_ip: '10.0.0.1' }],
    });
    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    const reopenedCheckbox = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.1');
    expect(reopenedCheckbox).toBeChecked();
  });

  it('supports multiple checked targets for a single public address', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
        { id: 'n3', vm_id: 'vm-1', ip_address: '10.0.0.2', role: 'private', sort_order: 2 },
      ],
      ip_mappings: [],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(vm);

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    const cb1 = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.1');
    const cb2 = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.2');

    fireEvent.click(cb1);
    fireEvent.click(cb2);

    expect(cb1).toBeChecked();
    expect(cb2).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][1];
    expect(payload.ip_mappings).toEqual([
      { public_ip: '203.0.113.1', private_ip: '10.0.0.1' },
      { public_ip: '203.0.113.1', private_ip: '10.0.0.2' },
    ]);
  });

  it('submits mapping-only changes', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
      ],
      ip_mappings: [{ public_ip: '203.0.113.1', private_ip: '10.0.0.1' }],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(vm);

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    const unlinkBtn = screen.getByRole('button', { name: 'Unlink all' });
    fireEvent.click(unlinkBtn);

    const cb = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.1');
    expect(cb).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][1];
    expect(payload.ip_mappings).toEqual([]);
  });

  it('requires explicit confirmation when removing a linked IP address', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
      ],
      ip_mappings: [{ public_ip: '203.0.113.1', private_ip: '10.0.0.1' }],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(vm);

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    // Try to remove private IP (row 2)
    const removeBtn = screen.getByRole('button', { name: 'Remove IP address 2' });
    fireEvent.click(removeBtn);

    // Confirm dialog must appear
    expect(screen.getByText('Remove Linked IP Address')).toBeInTheDocument();
    expect(screen.getByText(/Address "10.0.0.1" is currently linked in IP mappings/)).toBeInTheDocument();

    // Cancel first
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Remove Linked IP Address')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('10.0.0.1')).toBeInTheDocument();

    // Click remove again and confirm
    fireEvent.click(removeBtn);
    fireEvent.click(screen.getByRole('button', { name: 'Remove and Unlink' }));

    // Row is removed
    expect(screen.queryByDisplayValue('10.0.0.1')).not.toBeInTheDocument();

    // Save and check payload has 0 mappings and only 1 network
    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][1];
    expect(payload.networks).toHaveLength(1);
    expect(payload.ip_mappings).toEqual([]);
  });

  it('unlinks mappings when a linked IP address is edited to prevent silently moving mappings', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
      ],
      ip_mappings: [{ public_ip: '203.0.113.1', private_ip: '10.0.0.1' }],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(vm);

    renderWithProviders(<VmFormPage mode="edit" />);
    await screen.findByRole('heading', { name: `Edit ${vm.name}` });

    // Change private IP from 10.0.0.1 to 10.0.0.99
    const privInput = screen.getByLabelText('IP address 2');
    fireEvent.change(privInput, { target: { value: '10.0.0.99' } });

    // The mapping should be unlinked for the changed address
    const newCheckbox = screen.getByLabelText('Map 203.0.113.1 to 10.0.0.99');
    expect(newCheckbox).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][1];
    expect(payload.ip_mappings).toEqual([]);
  });

  it('allows newly added IP addresses entered on the form to be selected as mapping endpoints', async () => {
    renderWithProviders(<VmFormPage mode="create" />);
    await screen.findByRole('heading', { name: 'New VM' });

    // Add public IP in row 1
    const ip1Input = screen.getByLabelText('IP address 1');
    const role1Select = screen.getByLabelText('IP role 1');
    fireEvent.change(ip1Input, { target: { value: '203.0.113.50' } });
    fireEvent.change(role1Select, { target: { value: 'public' } });

    // Add private IP in row 2
    fireEvent.click(screen.getByRole('button', { name: '+ Add IP address' }));
    const ip2Input = screen.getByLabelText('IP address 2');
    const role2Select = screen.getByLabelText('IP role 2');
    fireEvent.change(ip2Input, { target: { value: '192.168.1.100' } });
    fireEvent.change(role2Select, { target: { value: 'private' } });

    // Verify checkbox appeared for the newly entered private IP
    const cb = await screen.findByLabelText('Map 203.0.113.50 to 192.168.1.100');
    expect(cb).toBeInTheDocument();
    expect(cb).not.toBeChecked();

    fireEvent.click(cb);
    expect(cb).toBeChecked();
  });
});
