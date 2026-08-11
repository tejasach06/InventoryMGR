import { apiRequest } from './core';
import type { AccentId } from '../lib/accentPresets';
import type { AppSettings, DropdownCategory, DropdownOption, DropdownOptions, LdapConfig, OsFamily } from './types';

export const settings = {
  getDropdownOptions: () => apiRequest<DropdownOptions>('/settings/options'),
  getAllDropdownOptions: () => apiRequest<DropdownOption[]>('/settings/options/all'),
  createDropdownOption: (category: DropdownCategory, value: string, family: OsFamily | null = null) =>
    apiRequest<DropdownOption>('/settings/options', { method: 'POST', body: JSON.stringify({ category, value, family }) }),
  updateDropdownOption: (id: string, value: string, family: OsFamily | null = null) =>
    apiRequest<DropdownOption>(`/settings/options/${id}`, { method: 'PATCH', body: JSON.stringify({ value, family }) }),
  deleteDropdownOption: (id: string) => apiRequest<null>(`/settings/options/${id}`, { method: 'DELETE' }),

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
