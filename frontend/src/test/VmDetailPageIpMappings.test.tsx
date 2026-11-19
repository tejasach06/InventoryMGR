import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { VmDetailPage } from '../routes/VmDetailPage';
import { makeUser, makeVm, renderWithProviders } from './utils';
import { vms as vmsApi } from '../api/vms';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'vm-1' }),
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VmDetailPage - IP Mappings', () => {
  it('shows private targets under corresponding public address and mapped from under private address', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
        { id: 'n3', vm_id: 'vm-1', ip_address: '10.0.0.2', role: 'private', sort_order: 2 },
      ],
      ip_mappings: [
        { public_ip: '203.0.113.1', private_ip: '10.0.0.1' },
        { public_ip: '203.0.113.1', private_ip: '10.0.0.2' },
      ],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);

    renderWithProviders(<VmDetailPage />, { user: makeUser() });
    await screen.findByRole('heading', { name: vm.name });

    // Under public address: shows mapped targets
    expect(screen.getByText('Mapped to:')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1, 10.0.0.2')).toBeInTheDocument();

    // Under private addresses: shows mapped from
    expect(screen.getAllByText('Mapped from:').length).toBe(2);
    expect(screen.getAllByText('203.0.113.1').length).toBeGreaterThanOrEqual(2);
  });

  it('routes linked edits through the VM form for linked addresses while keeping remove for unlinked', async () => {
    const vm = makeVm({
      networks: [
        { id: 'n1', vm_id: 'vm-1', ip_address: '203.0.113.1', role: 'public', sort_order: 0 },
        { id: 'n2', vm_id: 'vm-1', ip_address: '10.0.0.1', role: 'private', sort_order: 1 },
        { id: 'n3', vm_id: 'vm-1', ip_address: '192.168.1.5', role: 'backup', sort_order: 2 },
      ],
      ip_mappings: [
        { public_ip: '203.0.113.1', private_ip: '10.0.0.1' },
      ],
    });
    vi.spyOn(vmsApi, 'getVm').mockResolvedValue(vm);

    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByRole('heading', { name: vm.name });

    // Linked rows (n1, n2) should have "Edit in form" links
    const editInFormLinks = screen.getAllByRole('link', { name: 'Edit in form' });
    expect(editInFormLinks.length).toBe(2);
    for (const link of editInFormLinks) {
      expect(link).toHaveAttribute('href', '/inventory/vm-1/edit');
    }

    // Linked rows should NOT have direct remove buttons
    expect(screen.queryByTitle('Remove 203.0.113.1')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove 10.0.0.1')).not.toBeInTheDocument();

    // Unlinked backup IP (n3) still has the remove button
    expect(screen.getByTitle('Remove 192.168.1.5')).toBeInTheDocument();
  });
});
