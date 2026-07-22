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
    cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
  });
  vi.spyOn(api, 'listVmOwners').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VmFormPage vm_type / decommission_date gating', () => {
  it('disables decommission date for a permanent VM and enables it for temporary', () => {
    renderWithProviders(<VmFormPage mode="create" />);

    expect(screen.getByLabelText('Decommission Date')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('VM Type'), { target: { value: 'temporary' } });
    expect(screen.getByLabelText('Decommission Date')).not.toBeDisabled();
  });

  it('clears decommission date when switching back to permanent', () => {
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText('VM Type'), { target: { value: 'temporary' } });
    fireEvent.change(screen.getByLabelText('Decommission Date'), { target: { value: '2026-12-31' } });
    expect(screen.getByLabelText('Decommission Date')).toHaveValue('2026-12-31');

    fireEvent.change(screen.getByLabelText('VM Type'), { target: { value: 'permanent' } });
    expect(screen.getByLabelText('Decommission Date')).toHaveValue('');
    expect(screen.getByLabelText('Decommission Date')).toBeDisabled();
  });

  it('rejects submitting a temporary VM without a decommission date', async () => {
    const create = vi.spyOn(api, 'createVm').mockResolvedValue(makeVm({ id: 'vm-new' }));
    renderWithProviders(<VmFormPage mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'temp-vm' } });
    fireEvent.change(screen.getByLabelText(/^Cluster/), { target: { value: 'cluster-a' } });
    fireEvent.change(screen.getByLabelText('VM Type'), { target: { value: 'temporary' } });
    fireEvent.submit(screen.getByLabelText(/^Name/).closest('form') as HTMLFormElement);

    expect(await screen.findByText('Decommission date is required for temporary VMs.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
