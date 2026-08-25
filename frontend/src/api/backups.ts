import { API_PREFIX, apiRequest } from './core';
import type { BackupJob, BackupSettings, BackupsOverview } from './types';

export const backups = {
  overview: () => apiRequest<BackupsOverview>('/backups'),
  create: () => apiRequest<BackupJob>('/backups', { method: 'POST', timeoutMs: 600_000 }),
  remove: (name: string) => apiRequest<null>(`/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  downloadUrl: (name: string) => `${API_PREFIX}/backups/${encodeURIComponent(name)}/download`,
  updateSettings: (patch: { enabled?: boolean; hour_utc?: number; retention?: number }) =>
    apiRequest<BackupSettings>('/backups/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  restore: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    body.set('confirm', 'RESTORE');
    return apiRequest<BackupJob>('/backups/restore', { method: 'POST', body, timeoutMs: 1_800_000 });
  },
};
