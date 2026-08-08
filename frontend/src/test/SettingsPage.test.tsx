import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import type { User } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { buildNavItems } from '../components/AppNav';
import { makeUser, renderWithProviders } from './utils';

const mockUsers: User[] = [
  { id: 'u1', email: 'admin@example.com', role: 'admin', is_active: true, auth_source: 'local', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('inventorymgr-theme', 'light');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('defaults to Appearance for admins', () => {
    renderWithProviders(<SettingsPage />, { user: makeUser() });

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument();
  });

  it('persists Violet after applying its light accent immediately', async () => {
    const setAccent = vi.spyOn(api, 'setAccent').mockResolvedValue({ accent: 'violet' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#f97316'));

    await user.click(screen.getByRole('radio', { name: 'Violet' }));

    expect(setAccent).toHaveBeenCalledWith('violet');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#7c3aed');
  });

  it('restores prior accent and shows error when accent save fails', async () => {
    vi.spyOn(api, 'setAccent').mockRejectedValue(new Error('Accent save failed'));
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#f97316'));

    await user.click(screen.getByRole('radio', { name: 'Violet' }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#f97316');
      expect(screen.getByRole('alert')).toHaveTextContent('Accent save failed');
    });
  });

  it('keeps a newer accent when an earlier save fails', async () => {
    let resolveFirst: (value: { accent: 'violet' }) => void = () => {};
    let rejectFirst: (reason: Error) => void = () => {};
    const firstSave = new Promise<{ accent: 'violet' }>((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    const firstSavePromise = firstSave; // Alias for clarity if needed
    const setAccent = vi.spyOn(api, 'setAccent')
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ accent: 'blue' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });
    await user.click(screen.getByRole('radio', { name: 'Violet' }));
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await waitFor(() => expect(setAccent).toHaveBeenCalledTimes(2));
    rejectFirst(new Error('Stale save failed'));
    await firstSave.catch(() => undefined);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#2563eb');
      expect(window.localStorage.getItem('inventorymgr-accent')).toBe('blue');
      expect(screen.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('selects and focuses adjacent accent swatch with arrow keys', async () => {
    vi.spyOn(api, 'setAccent').mockResolvedValue({ accent: 'blue' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });
    const orange = screen.getByRole('radio', { name: 'Orange' });
    orange.focus();
    await user.keyboard('{ArrowRight}');

    const blue = screen.getByRole('radio', { name: 'Blue' });
    expect(blue).toHaveAttribute('aria-checked', 'true');
    expect(blue).toHaveFocus();
  });

  it('shows Settings navigation and only Appearance for viewers', () => {
    expect(buildNavItems({ role: 'viewer' }).find((item) => item.label === 'Settings')?.visible).toBe(true);

    renderWithProviders(<SettingsPage />, { user: makeUser({ role: 'viewer' }) });

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'LDAP' })).not.toBeInTheDocument();
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

  it('opens LDAP settings from its tab', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(api, 'getLdapConfig').mockResolvedValue({ enabled: false, server_uri: 'ldap://localhost', start_tls: false, verify_tls: true, bind_dn: null, bind_password_set: false, user_base_dn: '', user_filter: '(uid={username})', email_attribute: 'mail', group_attribute: 'memberOf', admin_group_dn: null, editor_group_dn: null, viewer_group_dn: null, default_role: 'viewer' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />, { user: makeUser() });

    const ldapTab = screen.getByRole('tab', { name: 'LDAP' });
    await user.click(ldapTab);
    expect(ldapTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('Server URI')).toBeInTheDocument();
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
