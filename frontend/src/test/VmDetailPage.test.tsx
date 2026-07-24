import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api, ApiError } from '../api/client';
import type { Vm } from '../api/client';
import { VmDetailPage } from '../routes/VmDetailPage';
import { makeUser, makeVm, renderWithProviders } from './utils';

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

describe('VmDetailPage', () => {
  it('shows the loading skeleton while the VM query is pending', () => {
    vi.spyOn(api, 'getVm').mockReturnValue(Promise.race<Vm>([]));
    renderWithProviders(<VmDetailPage />, { user: makeUser() });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('renders an alert when the VM query fails', async () => {
    vi.spyOn(api, 'getVm').mockRejectedValue(new ApiError(404, 'VM not found'));
    renderWithProviders(<VmDetailPage />, { user: makeUser() });
    expect(await screen.findByText('VM not found')).toBeInTheDocument();
  });

  it('renders VM details on success', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser() });

    expect(await screen.findByRole('heading', { name: 'web-01' })).toBeInTheDocument();
    expect(screen.getByText('8 GB')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.10, 10.0.0.11')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Record' })).toBeInTheDocument();
    expect(screen.getByText('Linux')).toBeInTheDocument();
    expect(screen.getAllByText('Yes').length).toBeGreaterThanOrEqual(2);
  });

  it('hides Edit and Delete for viewers', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows Edit but not Delete for editors', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'editor' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    const editLink = screen.getByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', '/inventory/vm-1/edit');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows both Edit and Delete for admins', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/inventory/vm-1/edit');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders all detail fields including lifecycle, OS name, and technical owner', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser() });

    await screen.findByRole('heading', { name: 'web-01' });
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Technical Owner')).toBeInTheDocument();
    expect(screen.getByText('OS Name')).toBeInTheDocument();
  });

  it('navigates to inventory list when Back is clicked', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    renderWithProviders(<VmDetailPage />, { user: makeUser() });

    await screen.findByRole('heading', { name: 'web-01' });
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(pushMock).toHaveBeenCalledWith('/inventory');
  });

  it('deletes the VM and navigates home when delete is confirmed', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    const deleteSpy = vi.spyOn(api, 'deleteVm').mockResolvedValue(null);
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete VM web-01? This cannot be undone.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete VM' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('vm-1'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/inventory'));
  });

  it('does not delete when the confirmation is dismissed', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    const deleteSpy = vi.spyOn(api, 'deleteVm').mockResolvedValue(null);
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows an alert when the delete mutation fails', async () => {
    vi.spyOn(api, 'getVm').mockResolvedValue(makeVm());
    vi.spyOn(api, 'deleteVm').mockRejectedValue(new ApiError(500, 'Delete failed'));
    renderWithProviders(<VmDetailPage />, { user: makeUser({ role: 'admin' }) });

    await screen.findByRole('heading', { name: 'web-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete VM' }));

    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
