import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { settings as settingsApi } from '../api/settings';
import type { LdapConfig } from '../api/types';
import { LdapPanel } from '../routes/LdapSettingsPanel';
import { renderWithProviders } from './utils';

const config: LdapConfig = {
  enabled: false,
  server_uri: 'ldap://ldap.example.com',
  start_tls: false,
  verify_tls: true,
  bind_dn: 'cn=admin,dc=example,dc=com',
  bind_password_set: true,
  user_base_dn: 'dc=example,dc=com',
  user_filter: '(uid={username})',
  email_attribute: 'mail',
  group_attribute: 'memberOf',
  admin_group_dn: null,
  editor_group_dn: null,
  viewer_group_dn: null,
  default_role: 'viewer',
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('LdapPanel', () => {
  it('saves full configuration without an untouched password', async () => {
    vi.spyOn(settingsApi, 'getLdapConfig').mockResolvedValue(config);
    const save = vi.spyOn(settingsApi, 'updateLdapConfig').mockResolvedValue(config);
    renderWithProviders(<LdapPanel />);

    expect(await screen.findByDisplayValue('ldap://ldap.example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Bind DN')).toHaveValue(config.bind_dn));
    await waitFor(() => expect(screen.getByLabelText('User base DN')).toHaveValue(config.user_base_dn));
    fireEvent.click(screen.getByRole('button', { name: 'Save LDAP settings' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const { bind_password_set: _ignored, ...expected } = config;
    expect(save.mock.calls[0][0]).toEqual(expected);
    expect(save.mock.calls[0][0]).not.toHaveProperty('bind_password');
  });

  it('sends touched password and renders connection result', async () => {
    vi.spyOn(settingsApi, 'getLdapConfig').mockResolvedValue(config);
    vi.spyOn(settingsApi, 'updateLdapConfig').mockResolvedValue(config);
    const testConnection = vi.spyOn(settingsApi, 'testLdapConnection').mockResolvedValue({ ok: true, message: 'Service bind succeeded' });
    renderWithProviders(<LdapPanel />);

    fireEvent.change(await screen.findByLabelText('Bind password'), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LDAP settings' }));
    await waitFor(() => expect(settingsApi.updateLdapConfig).toHaveBeenCalledWith(expect.objectContaining({ bind_password: 's3cret' })));

    fireEvent.change(screen.getByLabelText('Test username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(testConnection).toHaveBeenCalledWith({ username: 'jdoe' }));
    expect(await screen.findByText('Service bind succeeded')).toBeInTheDocument();
  });
});
