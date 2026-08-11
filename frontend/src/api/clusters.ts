import { apiRequest } from './core';
import type { ClusterPayload, NodePayload, PhysicalCluster, PhysicalClusterListItem, PhysicalNode } from './types';

export const clusters = {
  listClusters: () => apiRequest<PhysicalClusterListItem[]>('/clusters'),
  getCluster: (id: string) => apiRequest<PhysicalCluster>(`/clusters/${id}`),
  createCluster: (payload: ClusterPayload) =>
    apiRequest<PhysicalCluster>('/clusters', { method: 'POST', body: JSON.stringify(payload) }),
  updateCluster: (id: string, payload: Partial<ClusterPayload>) =>
    apiRequest<PhysicalCluster>(`/clusters/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCluster: (id: string) => apiRequest<null>(`/clusters/${id}`, { method: 'DELETE' }),

  addNode: (clusterId: string, payload: NodePayload) =>
    apiRequest<PhysicalNode>(`/clusters/${clusterId}/nodes`, { method: 'POST', body: JSON.stringify(payload) }),
  updateNode: (clusterId: string, nodeId: string, payload: Partial<NodePayload>) =>
    apiRequest<PhysicalNode>(`/clusters/${clusterId}/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteNode: (clusterId: string, nodeId: string) =>
    apiRequest<null>(`/clusters/${clusterId}/nodes/${nodeId}`, { method: 'DELETE' }),
};
