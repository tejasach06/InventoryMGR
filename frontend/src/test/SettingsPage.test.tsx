import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { User } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { makeUser, renderWithProviders } from './utils';

const mockUsers: User[] = [
  { id: 'u1', email: 'admin@example.com', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('renders a horizontal tablist with Users as default tab and lists users', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const tablist = screen.getByRole('tablist', { name: 'Settings categories' });
    expect(tablist).not.toHaveAttribute('aria-orientation', 'vertical');

    const usersTab = screen.getByRole('tab', { name: 'Users' });
    expect(usersTab).toHaveAttribute('aria-selected', 'true');

    expect(screen.getByRole('tab', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cluster' })).not.toBeInTheDocument();

    expect(await screen.findAllByText('admin@example.com')).not.toHaveLength(0);
  });

  it('switches between Users and Notifications tabs', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const usersTab = await screen.findByRole('tab', { name: 'Users' });
    const notificationsTab = screen.getByRole('tab', { name: 'Notifications' });

    await user.click(notificationsTab);

    expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
    expect(usersTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText(/days before decommission/i)).toBeInTheDocument();

    await user.click(usersTab);
    expect(usersTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('admin@example.com')).not.toHaveLength(0);
  });

  it('saves the decommission notify window from Notifications tab', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(api, 'getAppSettings').mockResolvedValue({ decommission_notify_days: 30, storage_usage_warn_pct: 85 });
    const updateSpy = vi.spyOn(api, 'updateAppSettings').mockResolvedValue({ decommission_notify_days: 60, storage_usage_warn_pct: 85 });

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    fireEvent.click(await screen.findByRole('tab', { name: /notifications/i }));
    const input = await screen.findByLabelText(/days before decommission/i);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /save window/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ decommission_notify_days: 60 }));
  });

  it('saves the storage usage warning threshold from Notifications tab', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
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
