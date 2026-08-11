import { apiRequest } from './core';
import type { ArrayPayload, Lun, NfsShare, StorageArray, StorageArrayListItem, StorageVolume } from './types';

export const storage = {
  listArrays: () => apiRequest<StorageArrayListItem[]>('/storage/arrays'),
  getArray: (id: string) => apiRequest<StorageArray>(`/storage/arrays/${id}`),
  createArray: (payload: ArrayPayload) =>
    apiRequest<StorageArray>('/storage/arrays', { method: 'POST', body: JSON.stringify(payload) }),
  updateArray: (id: string, payload: Partial<ArrayPayload>) =>
    apiRequest<StorageArray>(`/storage/arrays/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteArray: (id: string) => apiRequest<null>(`/storage/arrays/${id}`, { method: 'DELETE' }),

  addVolume: (arrayId: string, payload: Partial<Omit<StorageVolume, 'id' | 'array_id' | 'used_pct' | 'over_threshold' | 'luns' | 'shares'>> & { name: string }) =>
    apiRequest<StorageVolume>(`/storage/arrays/${arrayId}/volumes`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteVolume: (arrayId: string, volumeId: string) =>
    apiRequest<null>(`/storage/arrays/${arrayId}/volumes/${volumeId}`, { method: 'DELETE' }),

  addLun: (volumeId: string, payload: Partial<Omit<Lun, 'id' | 'volume_id'>> & { name: string }) =>
    apiRequest<Lun>(`/storage/volumes/${volumeId}/luns`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteLun: (volumeId: string, lunId: string) =>
    apiRequest<null>(`/storage/volumes/${volumeId}/luns/${lunId}`, { method: 'DELETE' }),

  addShare: (volumeId: string, payload: Partial<Omit<NfsShare, 'id' | 'volume_id'>> & { export_path: string }) =>
    apiRequest<NfsShare>(`/storage/volumes/${volumeId}/shares`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteShare: (volumeId: string, shareId: string) =>
    apiRequest<null>(`/storage/volumes/${volumeId}/shares/${shareId}`, { method: 'DELETE' }),
};
