import { apiRequest } from './core';
import type { CommitResult, ImportBatch } from './types';

export const imports = {
  previewImport: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return apiRequest<ImportBatch>('/imports/preview', { method: 'POST', body });
  },
  getImport: (id: string) => apiRequest<ImportBatch>(`/imports/${id}`),
  commitImport: (id: string) => apiRequest<CommitResult>(`/imports/${id}/commit`, { method: 'POST' }),
};
