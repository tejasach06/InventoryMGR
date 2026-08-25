import { apiRequest } from './core';
import type { AccentId } from '../lib/accentPresets';
import type { AppSettings, DropdownOptions, LdapConfig } from './types';

export const settings = {
  getDropdownOptions: () => apiRequest<DropdownOptions>('/settings/options'),

  getColumnPreferences: (pageKey: string) =>
    apiRequest<{ columns: { key: string; visible: boolean; order: number }[] }>(`/user/preferences/${pageKey}`),
  updateColumnPreferences: (pageKey: string, columns: { key: string; visible: boolean; order: number }[]) =>
    apiRequest<{ columns: { key: string; visible: boolean; order: number }[] }>(
      `/user/preferences/${pageKey}`, { method: 'PUT', body: JSON.stringify({ columns }) },
    ),
  getAccent: () => apiRequest<{ accent: AccentId }>('/user/accent'),
  setAccent: (accent: AccentId) =>
    apiRequest<{ accent: AccentId }>('/user/accent', { method: 'PUT', body: JSON.stringify({ accent }) }),

  getAppSettings: () => apiRequest<AppSettings>('/settings/app'),
  updateAppSettings: (patch: { decommission_notify_days?: number; storage_usage_warn_pct?: number }) =>
    apiRequest<AppSettings>('/settings/app', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getLdapConfig: () => apiRequest<LdapConfig>('/settings/ldap'),
  updateLdapConfig: (body: Omit<LdapConfig, 'bind_password_set'> & { bind_password?: string | null }) =>
    apiRequest<LdapConfig>('/settings/ldap', { method: 'PUT', body: JSON.stringify(body) }),
  testLdapConnection: (body: { username?: string; password?: string }) =>
    apiRequest<{ ok: boolean; message: string }>('/settings/ldap/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
