'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, ClusterPayload, PhysicalCluster, PhysicalNode } from '../api/client';
import {
  Alert, PageHeader, PageTransition, Skeleton, Spinner,
  dangerButtonClass, primaryButtonClass, secondaryButtonClass, sectionTitleClass,
} from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ClusterForm } from '../components/ClusterForm';
import type { ClusterFormValues } from '../components/ClusterForm';

interface NodeFieldDef {
  name: string;
  placeholder: string;
  type?: string;
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400">
      ×
    </button>
  );
}

const NODE_FIELDS: NodeFieldDef[] = [
  { name: 'name', placeholder: 'Node name' },
  { name: 'cpu_model', placeholder: 'CPU model' },
  { name: 'cpu_cores', placeholder: 'CPU cores', type: 'number' },
  { name: 'cpu_threads', placeholder: 'CPU threads', type: 'number' },
  { name: 'ram_total_gb', placeholder: 'RAM total GB', type: 'number' },
  { name: 'ram_used_gb', placeholder: 'RAM used GB', type: 'number' },
  { name: 'storage_usable_gb', placeholder: 'Storage GB', type: 'number' },
  { name: 'datacenter', placeholder: 'Datacenter' },
  { name: 'rack', placeholder: 'Rack' },
  { name: 'rack_unit', placeholder: 'Rack unit' },
  { name: 'ip_label', placeholder: 'IP label (e.g. mgmt)' },
  { name: 'ip_address', placeholder: 'IP address' },
];

function NodeAddForm({ onSubmit, pending }: {
  onSubmit: (payload: Partial<PhysicalNode> & { name: string }) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(NODE_FIELDS.map((f) => [f.name, '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  const inputClass = 'min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400';

  function submit() {
    const v = values;
    const ip_addresses = v.ip_label.trim() && v.ip_address.trim()
      ? [{ label: v.ip_label.trim(), address: v.ip_address.trim() }]
      : [];
    onSubmit({
      name: v.name.trim(),
      cpu_model: v.cpu_model.trim() || null,
      cpu_cores: Number(v.cpu_cores) || 0,
      cpu_threads: Number(v.cpu_threads) || 0,
      ram_total_gb: Number(v.ram_total_gb) || 0,
      ram_used_gb: v.ram_used_gb.trim() ? Number(v.ram_used_gb) : null,
      storage_usable_gb: Number(v.storage_usable_gb) || 0,
      datacenter: v.datacenter.trim() || null,
      rack: v.rack.trim() || null,
      rack_unit: v.rack_unit.trim() || null,
      ip_addresses,
    });
    setValues(blank());
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      {NODE_FIELDS.map((f) => (
        <input key={f.name} type={f.type ?? 'text'} placeholder={f.placeholder} value={values[f.name]}
          aria-label={f.placeholder}
          onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))} className={inputClass} />
      ))}
      <button type="button" onClick={submit} disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
        {pending ? <Spinner /> : null}+ Add
      </button>
    </div>
  );
}

function RamBar({ used, total }: { used: number | null; total: number }) {
  const pct = total > 0 && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-24 text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
        {used === null ? '—' : `${used} / ${total} GB`}
      </span>
    </div>
  );
}

function NodesArea({ cluster, canEdit }: { cluster: PhysicalCluster; canEdit: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cluster', cluster.id] });
  const addNode = useMutation({
    mutationFn: (payload: Partial<PhysicalNode> & { name: string }) => api.addNode(cluster.id, payload),
    onSuccess: invalidate,
  });
  const delNode = useMutation({
    mutationFn: (nodeId: string) => api.deleteNode(cluster.id, nodeId),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <h2 className={sectionTitleClass}>Nodes</h2>
      {cluster.nodes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No nodes yet.</p>
      ) : (
        <table className="mt-1 w-full text-sm"><thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="pb-1 pr-4">Name</th><th className="pb-1 pr-4">IPs</th><th className="pb-1 pr-4">CPU model</th>
            <th className="pb-1 pr-4">Cores/Threads</th><th className="pb-1 pr-4">RAM</th><th className="pb-1 pr-4">Storage (GB)</th>
            <th className="pb-1 pr-4">Location</th><th />
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {cluster.nodes.map((n) => (
              <tr key={n.id}>
                <td className="py-1.5 pr-4 font-mono text-slate-700 dark:text-slate-300">{n.name}</td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">
                  {n.ip_addresses.length === 0 ? '—' : n.ip_addresses.map((ip) => `${ip.label} ${ip.address}`).join(', ')}
                </td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{n.cpu_model ?? '—'}</td>
                <td className="py-1.5 pr-4 tabular-nums">{n.cpu_cores} / {n.cpu_threads}</td>
                <td className="py-1.5 pr-4"><RamBar used={n.ram_used_gb} total={n.ram_total_gb} /></td>
                <td className="py-1.5 pr-4 tabular-nums">{n.storage_usable_gb}</td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">
                  {[n.datacenter, n.rack, n.rack_unit].filter(Boolean).join(' / ') || '—'}
                </td>
                <td className="py-1.5">{canEdit && <RemoveButton onClick={() => delNode.mutate(n.id)} label={`Remove node ${n.name}`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && <NodeAddForm onSubmit={(v) => addNode.mutate(v)} pending={addNode.isPending} />}
      {addNode.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addNode.error)}</p>}
    </div>
  );
}

export function ClusterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';

  const clusterQ = useQuery({ queryKey: ['cluster', id], queryFn: () => api.getCluster(id) });
  const cluster = clusterQ.data;

  const deleteMut = useMutation({
    mutationFn: () => api.deleteCluster(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters'] }); router.push('/clusters'); },
  });

  const [editing, setEditing] = useState(false);
  const updateMut = useMutation({
    mutationFn: (payload: ClusterPayload) => api.updateCluster(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cluster', id] });
      qc.invalidateQueries({ queryKey: ['clusters'] });
      setEditing(false);
    },
  });

  if (clusterQ.isLoading) return <PageTransition><Skeleton className="h-64 w-full" /></PageTransition>;
  if (clusterQ.isError) return <PageTransition><Alert>{detailMessage(clusterQ.error)}</Alert></PageTransition>;
  if (!cluster) return null;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl space-y-5">
        <PageHeader title={cluster.name} eyebrow="Cluster" actions={
          <>
            <button className={secondaryButtonClass} onClick={() => router.push('/clusters')}>← Back</button>
            {canEdit && (
              <button className={dangerButtonClass}
                onClick={() => { if (confirm(`Delete cluster ${cluster.name} and all its nodes? This cannot be undone.`)) deleteMut.mutate(); }}
                disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete cluster
              </button>
            )}
          </>
        } />

        {deleteMut.isError && <Alert>{detailMessage(deleteMut.error)}</Alert>}

        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
          <div className="flex items-center justify-between">
            <h2 className={sectionTitleClass}>Details</h2>
            {canEdit && !editing ? (
              <button className={primaryButtonClass} onClick={() => setEditing(true)}>Edit</button>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-4">
              <ClusterForm
                initial={{
                  name: cluster.name,
                  description: cluster.description ?? '',
                  notes: cluster.notes ?? '',
                } as Partial<ClusterFormValues>}
                onSubmit={(payload) => updateMut.mutate(payload)}
                onCancel={() => setEditing(false)}
                pending={updateMut.isPending}
                submitLabel="Save changes"
              />
              {updateMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(updateMut.error)}</p> : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{cluster.description || 'No description.'}</p>
          )}
        </section>

        <NodesArea cluster={cluster} canEdit={canEdit} />
      </section>
    </PageTransition>
  );
}