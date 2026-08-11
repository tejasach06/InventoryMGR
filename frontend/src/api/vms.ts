import { API_PREFIX, apiRequest } from './core';
import type { Application, AuditLogEntry, BulkPatch, BulkResult, Disk, DueVm, Network, Vm, VmList, VmPayload } from './types';

export const vms = {
  listVms: (params: URLSearchParams) => apiRequest<VmList>(`/vms?${params.toString()}`),
  getVm: (id: string) => apiRequest<Vm>(`/vms/${id}`),
  createVm: (payload: VmPayload) => apiRequest<Vm>('/vms', { method: 'POST', body: JSON.stringify(payload) }),
  updateVm: (id: string, payload: Partial<VmPayload>) =>
    apiRequest<Vm>(`/vms/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVm: (id: string) => apiRequest<null>(`/vms/${id}`, { method: 'DELETE' }),
  cloneVm: (id: string) => apiRequest<Vm>(`/vms/${id}/clone`, { method: 'POST' }),
  bulkUpdateVms: (body: { ids?: string[]; filters?: Record<string, unknown>; patch: BulkPatch }) =>
    apiRequest<BulkResult>('/vms/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  exportVmsUrl: (params?: URLSearchParams, format: 'csv' | 'xlsx' = 'csv') => {
    const query = new URLSearchParams(params ?? undefined);
    if (format !== 'csv') query.set('format', format);
    return query.toString() ? `${API_PREFIX}/vms/export?${query.toString()}` : `${API_PREFIX}/vms/export`;
  },
  exportSelectedUrl: (ids: string[], format: 'csv' | 'xlsx' = 'csv') => {
    const query = new URLSearchParams(ids.map((id) => ['ids', id]));
    if (format !== 'csv') query.set('format', format);
    return `${API_PREFIX}/vms/export?${query.toString()}`;
  },
  listVmOwners: () => apiRequest<string[]>('/vms/owners'),
  listVmClusters: () => apiRequest<string[]>('/vms/clusters'),
  listVmNodes: () => apiRequest<string[]>('/vms/nodes'),
  listVmApplications: () => apiRequest<string[]>('/vms/applications'),
  listVmTags: () => apiRequest<string[]>('/vms/tags'),

  listDisks: (vmId: string) => apiRequest<Disk[]>(`/vms/${vmId}/disks`),
  addDisk: (vmId: string, payload: Omit<Disk, 'id' | 'vm_id'>) =>
    apiRequest<Disk>(`/vms/${vmId}/disks`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteDisk: (vmId: string, diskId: string) =>
    apiRequest<null>(`/vms/${vmId}/disks/${diskId}`, { method: 'DELETE' }),

  listNetworks: (vmId: string) => apiRequest<Network[]>(`/vms/${vmId}/networks`),
  addNetwork: (vmId: string, payload: Omit<Network, 'id' | 'vm_id'>) =>
    apiRequest<Network>(`/vms/${vmId}/networks`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteNetwork: (vmId: string, networkId: string) =>
    apiRequest<null>(`/vms/${vmId}/networks/${networkId}`, { method: 'DELETE' }),

  listApplications: (vmId: string) => apiRequest<Application[]>(`/vms/${vmId}/applications`),
  addApplication: (vmId: string, payload: Omit<Application, 'id' | 'vm_id'>) =>
    apiRequest<Application>(`/vms/${vmId}/applications`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteApplication: (vmId: string, appId: string) =>
    apiRequest<null>(`/vms/${vmId}/applications/${appId}`, { method: 'DELETE' }),

  getAuditLog: (vmId: string, limit = 50) =>
    apiRequest<AuditLogEntry[]>(`/vms/${vmId}/audit?limit=${limit}`),

  decommissionNotifications: () => apiRequest<DueVm[]>('/notifications/decommissions'),
  ackDecommissions: (vmIds?: string[]) =>
    apiRequest<null>('/notifications/decommissions/ack', {
      method: 'POST',
      body: JSON.stringify({ vm_ids: vmIds ?? null }),
    }),
};
