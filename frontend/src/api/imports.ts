import { apiRequest } from './core';
import type { CommitResult, ImportBatch } from './types';

export const imports = {
  previewImport: (file: File, fullInventory = false) => {
    const body = new FormData();
    body.set('file', file);
    body.set('full_inventory', String(fullInventory));
    return apiRequest<ImportBatch>('/imports/preview', { method: 'POST', body });
  },
  getImport: (id: string) => apiRequest<ImportBatch>(`/imports/${id}`),
  commitImport: (id: string, confirmDecommission = false) =>
    apiRequest<CommitResult>(`/imports/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ confirm_decommission: confirmDecommission }),
    }),
};
