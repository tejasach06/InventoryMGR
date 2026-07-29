import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../api/client';
import type { DropdownOption } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { makeUser, renderWithProviders } from './utils';

const clusterOptions: DropdownOption[] = [{ id: 'o1', category: 'cluster', value: 'cluster-a', family: null }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows the loading skeleton on first render before the options query resolves', () => {
    // The query is pending on the initial synchronous render; resolution happens on
    // a later microtask, so asserting before any await observes the loading state.
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders an error alert when the options query rejects', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockRejectedValue(new ApiError(500, 'Boom'));

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders a vertical nav with the Cluster tab, a link to Users, and lists the cluster option', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(await screen.findByRole('tab', { name: 'Cluster' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.queryByRole('tab', { name: 'CPU cores' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Datacenter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Disk size (GB)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Operating system' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users');
    expect(screen.getByText('cluster-a')).toBeInTheDocument();
  });

  it('switches the active panel when Notifications is clicked, and back', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const clusterTab = await screen.findByRole('tab', { name: 'Cluster' });
    expect(clusterTab).toHaveAttribute('aria-selected', 'true');

    const notificationsTab = screen.getByRole('tab', { name: /notifications/i });
    await user.click(notificationsTab);

    expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
    expect(clusterTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-notifications');

    await user.click(clusterTab);
    expect(clusterTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-cluster');
  });

  it('creates a new cluster option from the add form', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const createSpy = vi
      .spyOn(api, 'createDropdownOption')
      .mockResolvedValue({ id: 'o2', category: 'cluster', value: 'cluster-b', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.type(screen.getByLabelText('Add Cluster option'), 'cluster-b');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('cluster', 'cluster-b'));
  });

  it('edits an existing cluster option and saves the new value', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const updateSpy = vi
      .spyOn(api, 'updateDropdownOption')
      .mockResolvedValue({ id: 'o1', category: 'cluster', value: 'cluster-c', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editInput = screen.getByLabelText('Edit cluster-a');
    await user.clear(editInput);
    await user.type(editInput, 'cluster-c');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('o1', 'cluster-c'));
  });

  it('deletes a cluster option after the confirm dialog is accepted', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    const deleteSpy = vi.spyOn(api, 'deleteDropdownOption').mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    await screen.findByRole('tab', { name: 'Cluster' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('o1'));
  });

  it('links to the standalone Users page instead of duplicating it as a tab', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const usersLink = await screen.findByRole('link', { name: /users/i });
    expect(usersLink).toHaveAttribute('href', '/users');
    expect(screen.queryByRole('tab', { name: /^users$/i })).not.toBeInTheDocument();
  });

  it('saves the decommission notify window', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 60, storage_usage_warn_pct: 85 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/days before decommission/i);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /save window/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ decommission_notify_days: 60 }));
  });

  it('saves the storage usage warning threshold', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(clusterOptions);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 90 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/storage usage warning threshold/i);
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /save threshold/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ storage_usage_warn_pct: 90 }));
  });
});
