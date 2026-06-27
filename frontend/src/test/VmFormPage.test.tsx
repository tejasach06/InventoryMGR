import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VmFormPage } from '../routes/VmFormPage';
import { api, ApiError } from '../api/client';
import type { Vm } from '../api/client';
import { makeVm, renderWithProviders } from './utils';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'vm-1' }),
  useRouter: () => ({ push: pushMock }),
}));

function fillRequiredCreateFields() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'test-vm' } });
  fireEvent.change(screen.getByLabelText(/^Cluster/), { target: { value: 'cluster-x' } });
  fireEvent.change(screen.getByLabelText(/^Memory GB/), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Disk 1 size'), { target: { value: '50' } });
}

beforeEach(() => {
  pushMock.mockClear();
  // jsdom does not implement scrollIntoView, which the submit handler calls on the first invalid field.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({ cpu: [], datacenter: [], disk: [], os: [], os_by_family: { linux: [], windows: [] } });
  vi.spyOn(api, 'listVmOwners').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VmFormPage', () => {
  it('renders the create heading and required fields in create mode', async () => {
    renderWithProviders(<VmFormPage mode="create" />);

    expect(await screen.findByRole('heading', { name: 'New VM' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cluster/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Memory GB/)).toBeInTheDocument();
    expect(screen.getByLabelText('Disk 1 size')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save VM' })).toBeInTheDocument();
  });

  it('shows validation errors and does not submit when required fields are blank', async () => {
    const createSpy = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmFormPage mode="create" />);
    await screen.findByRole('heading', { name: 'New VM' });

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Cluster is required.')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('creates a VM and navigates on success, applying the GB to MB transform', async () => {
    const createSpy = vi
      .spyOn(api, 'createVm')
      .mockResolvedValue(makeVm({ id: 'vm-99', name: 'test-vm' }));
    renderWithProviders(<VmFormPage mode="create" />);
    await screen.findByRole('heading', { name: 'New VM' });

    fillRequiredCreateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const payload = createSpy.mock.calls[0][0];
    expect(payload.name).toBe('test-vm');
    expect(payload.memory_mb).toBe(4096);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/inventory/vm-99'));
  });

  it('sends backup_enabled true when the backup checkbox is toggled on', async () => {
    const createSpy = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm({ id: 'vm-77' }));
    renderWithProviders(<VmFormPage mode="create" />);
    await screen.findByRole('heading', { name: 'New VM' });

    fillRequiredCreateFields();
    const backup = screen.getByLabelText('Backup enabled');
    expect(backup).not.toBeChecked();
    fireEvent.click(backup);
    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][0].backup_enabled).toBe(true);
  });

  it('pre-populates the form in edit mode and submits via updateVm', async () => {
    const vm = makeVm({ id: 'vm-1', name: 'web-01' });
    vi.spyOn(api, 'getVm').mockResolvedValue(vm);
    const updateSpy = vi.spyOn(api, 'updateVm').mockResolvedValue(vm);
    renderWithProviders(<VmFormPage mode="edit" />);

    const nameInput = await screen.findByLabelText(/^Name/);
    await waitFor(() => expect(nameInput).toHaveValue('web-01'));

    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][0]).toBe('vm-1');
    expect(updateSpy.mock.calls[0][1].name).toBe('web-01');
    expect(updateSpy.mock.calls[0][1].memory_mb).toBe(8192);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/inventory/vm-1'));
  });

  it('shows the loading skeleton while the VM query is pending in edit mode', async () => {
    vi.spyOn(api, 'getVm').mockReturnValue(new Promise<Vm>(() => {}));
    renderWithProviders(<VmFormPage mode="edit" />);

    const skeleton = await screen.findByRole('status', { name: /loading/i });
    expect(skeleton).toHaveAttribute('aria-label', 'Loading form');
    expect(screen.queryByRole('button', { name: 'Save VM' })).not.toBeInTheDocument();
  });

  it('shows an Alert when the create mutation is rejected', async () => {
    vi.spyOn(api, 'createVm').mockRejectedValue(new ApiError(400, 'Name already exists'));
    renderWithProviders(<VmFormPage mode="create" />);
    await screen.findByRole('heading', { name: 'New VM' });

    fillRequiredCreateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save VM' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Name already exists');
  });
});
