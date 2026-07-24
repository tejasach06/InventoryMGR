'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, ClusterPayload, PhysicalCluster, PhysicalNode } from '../api/client';
import {
  Alert, ConfirmDialog, FieldError, PageHeader, PageTransition, Skeleton, Spinner, RemoveButton, cardClass, inputClass, labelClass,
  tableClass, tableBodyClass, tableCellClass, monoClass,
  dangerButtonClass, primaryButtonClass, secondaryButtonClass, sectionTitleClass,
} from '../components/ui';
import { cn } from '../lib/classNames';
import { useCurrentUser } from '../components/AuthContext';
import { ClusterForm } from '../components/ClusterForm';
import type { ClusterFormValues } from '../components/ClusterForm';

interface NodeFieldDef {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
}

const NODE_GROUPS: { title: string; fields: NodeFieldDef[] }[] = [
  { title: 'Identity', fields: [
    { name: 'name', label: 'Node name', placeholder: 'e.g. hv-node-03' },
  ] },
  { title: 'Compute', fields: [
    { name: 'cpu_model', label: 'CPU model' },
    { name: 'cpu_cores', label: 'CPU cores', type: 'number' },
    { name: 'cpu_threads', label: 'CPU threads', type: 'number' },
  ] },
  { title: 'Capacity', fields: [
    { name: 'ram_total_gb', label: 'RAM total (GB)', type: 'number' },
    { name: 'ram_used_gb', label: 'RAM used (GB)', type: 'number' },
    { name: 'storage_usable_gb', label: 'Storage (GB)', type: 'number' },
  ] },
  { title: 'Location', fields: [
    { name: 'datacenter', label: 'Datacenter' },
    { name: 'rack', label: 'Rack' },
    { name: 'rack_unit', label: 'Rack unit' },
  ] },
  { title: 'Network', fields: [
    { name: 'ip_label', label: 'IP label', placeholder: 'e.g. mgmt' },
    { name: 'ip_address', label: 'IP address' },
  ] },
];
const NODE_FIELDS = NODE_GROUPS.flatMap((g) => g.fields);

function NodeAddForm({ onSubmit, pending }: {
  onSubmit: (payload: Partial<PhysicalNode> & { name: string }) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(NODE_FIELDS.map((f) => [f.name, '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  const [nameError, setNameError] = useState<string | undefined>();

  function submit() {
    const v = values;
    if (!v.name.trim()) { setNameError('Node name is required.'); return; }
    setNameError(undefined);
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
    <div className="mt-4 grid gap-4 border-t border-[var(--color-border)] pt-4">
      {NODE_GROUPS.map((g) => (
        <div key={g.title} className="grid gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{g.title}</h5>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {g.fields.map((f) => (
              <label key={f.name} className="grid gap-1">
                {/* ponytail: no required-marker span on name label — getByLabelText(/^node name$/i)
                    in ClusterDetailPage.test.tsx does an exact match that a trailing "*" would break. */}
                <span className={labelClass}>{f.label}</span>
                <input type={f.type ?? 'text'} placeholder={f.placeholder} value={values[f.name]}
                  aria-describedby={f.name === 'name' && nameError ? 'node-name-error' : undefined}
                  aria-invalid={f.name === 'name' ? Boolean(nameError) : undefined}
                  onChange={(e) => { setValues((c) => ({ ...c, [f.name]: e.target.value })); if (f.name === 'name') setNameError(undefined); }} className={inputClass} />
                {f.name === 'name' && <FieldError id="node-name-error" message={nameError} />}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div>
        <button type="button" onClick={submit} disabled={pending} className={secondaryButtonClass}>
          {pending ? <Spinner /> : null}+ Add node
        </button>
      </div>
    </div>
  );
}

function RamBar({ used, total }: { used: number | null; total: number }) {
  const pct = total > 0 && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-tertiary)]">
        <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className={cn(monoClass, 'w-24 text-right')}>
        {used === null ? '—' : `${used} / ${total} GB`}
      </span>
    </div>
  );
}

function NodesArea({ cluster, canEdit }: { cluster: PhysicalCluster; canEdit: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
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
      <div className="flex items-center justify-between">
        <h2 className={sectionTitleClass}>Nodes</h2>
        {canEdit && (
          <button type="button" className={secondaryButtonClass} onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Cancel' : '+ Add node'}
          </button>
        )}
      </div>
      {cluster.nodes.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">No nodes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className={tableClass}>
            <thead>
              <tr className="text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                <th className={tableCellClass}>Name</th><th className={tableCellClass}>IPs</th><th className={tableCellClass}>CPU model</th>
                <th className={tableCellClass}>Cores/Threads</th><th className={tableCellClass}>RAM</th><th className={tableCellClass}>Storage (GB)</th>
                <th className={tableCellClass}>Location</th><th className={tableCellClass} />
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {cluster.nodes.map((n) => (
                <tr key={n.id} className="transition-colors hover:bg-[var(--color-accent)]/5">
                  <td className={cn(tableCellClass, monoClass)}>{n.name}</td>
                  <td className={cn(tableCellClass, monoClass)}>
                    {n.ip_addresses.length === 0 ? '—' : n.ip_addresses.map((ip) => `${ip.label} ${ip.address}`).join(', ')}
                  </td>
                  <td className={tableCellClass}>{n.cpu_model ?? '—'}</td>
                  <td className={cn(tableCellClass, 'tabular-nums')}>{n.cpu_cores} / {n.cpu_threads}</td>
                  <td className={tableCellClass}><RamBar used={n.ram_used_gb} total={n.ram_total_gb} /></td>
                  <td className={cn(tableCellClass, 'tabular-nums')}>{n.storage_usable_gb}</td>
                  <td className={tableCellClass}>
                    {[n.datacenter, n.rack, n.rack_unit].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className={tableCellClass}>{canEdit && <RemoveButton onClick={() => delNode.mutate(n.id)} label={`Remove node ${n.name}`} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && showAdd && <NodeAddForm onSubmit={(v) => addNode.mutate(v)} pending={addNode.isPending} />}
      {addNode.isError && <Alert>{detailMessage(addNode.error)}</Alert>}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
                onClick={() => setConfirmDelete(true)}
                disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete cluster
              </button>
            )}
          </>
        } />

        <ConfirmDialog open={confirmDelete} title="Delete cluster"
          body={`Delete cluster ${cluster.name} and all its nodes? This cannot be undone.`}
          pending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setConfirmDelete(false)} />

        {deleteMut.isError && <Alert>{detailMessage(deleteMut.error)}</Alert>}

        <section className={cardClass}>
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
              {updateMut.isError ? <Alert>{detailMessage(updateMut.error)}</Alert> : null}
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