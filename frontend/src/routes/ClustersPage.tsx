'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ClusterPayload, PhysicalClusterListItem } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton, primaryButtonClass, cardClass, tableWrapClass, tableClass, tableHeadClass, tableBodyClass, tableRowClass, tableCellClass } from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ClusterForm } from '../components/ClusterForm';

export function ClustersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const [showForm, setShowForm] = useState(false);

  const clustersQ = useQuery({ queryKey: ['clusters'], queryFn: () => api.listClusters() });
  const clusters: PhysicalClusterListItem[] = clustersQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: ClusterPayload) => api.createCluster(payload),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clusters'] });
      setShowForm(false);
      router.push(`/clusters/${created.id}`);
    },
  });

  return (
    <PageTransition>
      <PageHeader title="Clusters" eyebrow="Infrastructure" actions={
        canEdit && !showForm ? (
          <button className={primaryButtonClass} onClick={() => setShowForm(true)}>+ New cluster</button>
        ) : null
      } />

      {canEdit && showForm ? (
        <div className={`${cardClass} mb-6`}>
          <ClusterForm
            onSubmit={(payload) => createMut.mutate(payload)}
            onCancel={() => setShowForm(false)}
            pending={createMut.isPending}
            submitLabel="Create cluster"
          />
          {createMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(createMut.error)}</p> : null}
        </div>
      ) : null}

      {clustersQ.isError ? <Alert>{detailMessage(clustersQ.error)}</Alert> : null}

      {clustersQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : clusters.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-slate-500 dark:text-slate-400`}>
          No clusters yet.
        </div>
      ) : (
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={`${tableCellClass} text-left font-semibold`}>Name</th>
                <th className={`${tableCellClass} text-left font-semibold`}>Description</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Nodes</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Total RAM (GB)</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Total storage (GB)</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {clusters.map((c) => (
                <tr key={c.id} className={tableRowClass}>
                  <td className={tableCellClass}>
                    <Link href={`/clusters/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tableCellClass}>{c.description ?? '—'}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.node_count}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.total_ram_gb}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.total_storage_gb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageTransition>
  );
}