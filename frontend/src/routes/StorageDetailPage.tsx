'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, ArrayPayload, StorageArray, StorageVolume } from '../api/client';
import {
  Alert, ConfirmDialog, PageHeader, PageTransition, Skeleton, Spinner, RemoveButton, cardClass, inputClass,
  tableClass, tableBodyClass, tableCellClass, monoClass,
  dangerButtonClass, primaryButtonClass, secondaryButtonClass, sectionTitleClass,
} from '../components/ui';
import { cn } from '../lib/classNames';
import { useCurrentUser } from '../components/AuthContext';
import { ArrayForm } from '../components/ArrayForm';
import type { ArrayFormValues } from '../components/ArrayForm';

interface FieldDef {
  name: string;
  placeholder: string;
  type?: string;
  options?: readonly string[];
  required?: boolean;
}

function InlineAddForm({ fields, onSubmit, pending }: {
  fields: FieldDef[];
  onSubmit: (values: Record<string, string>) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  const [error, setError] = useState<string | undefined>();
  const fieldClass = cn(inputClass, 'min-w-0 flex-1 py-2');
  function submit() {
    const missing = fields.filter((f) => f.required && !values[f.name].trim());
    if (missing.length > 0) { setError(`${missing.map((f) => f.placeholder).join(', ')} required.`); return; }
    const nonPositive = fields.filter((f) => f.required && f.type === 'number' && Number(values[f.name]) <= 0);
    if (nonPositive.length > 0) { setError(`${nonPositive.map((f) => f.placeholder).join(', ')} must be greater than 0.`); return; }
    setError(undefined);
    onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
    setValues(blank());
  }
  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <div className="flex flex-wrap gap-2">
        {fields.map((f) => (
          f.options ? (
            <select key={f.name} aria-label={f.placeholder} value={values[f.name]}
              onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))} className={fieldClass}>
              <option value="">{f.placeholder}</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input key={f.name} type={f.type ?? 'text'} placeholder={f.required ? `${f.placeholder} *` : f.placeholder} value={values[f.name]}
              aria-label={f.placeholder} aria-invalid={error ? true : undefined}
              onChange={(e) => { setValues((c) => ({ ...c, [f.name]: e.target.value })); setError(undefined); }} className={fieldClass} />
          )
        ))}
        <button type="button" onClick={submit} disabled={pending} className={secondaryButtonClass}>
          {pending ? <Spinner /> : null}+ Add
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm" style={{ color: 'var(--color-criticality-critical)' } as React.CSSProperties}>{error}</p>}
    </div>
  );
}

function UsageBar({ pct, over }: { pct: number | null; over: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-tertiary)]">
        <div className={cn('h-full rounded-full transition-all', over ? 'bg-[var(--color-criticality-critical)]' : 'bg-[var(--color-accent)]')}
          style={{ width: `${pct === null ? 0 : Math.min(100, pct)}%` }} />
      </div>
      <span className={cn(monoClass, 'w-14 text-right font-semibold')}>
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

function VolumePanel({ volume, clusters, canEdit }: { volume: StorageVolume; clusters: string[]; canEdit: boolean }) {
  const [showAddLun, setShowAddLun] = useState(false);
  const [showAddShare, setShowAddShare] = useState(false);
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['array', volume.array_id] });
    qc.invalidateQueries({ queryKey: ['arrays'] });
  };
  const addLun = useMutation({
    mutationFn: (v: Record<string, string>) => api.addLun(volume.id, {
      name: v.name, size_gb: Number(v.size_gb) || 0,
      used_gb: v.used_gb ? Number(v.used_gb) : null,
      target_iqn: v.target_iqn || null, cluster: v.cluster || null, status: v.status || null,
      sort_order: volume.luns.length,
    }),
    onSuccess: invalidate,
  });
  const delLun = useMutation({ mutationFn: (id: string) => api.deleteLun(volume.id, id), onSuccess: invalidate });
  const addShare = useMutation({
    mutationFn: (v: Record<string, string>) => api.addShare(volume.id, {
      export_path: v.export_path, used_gb: v.used_gb ? Number(v.used_gb) : null,
      allowed_clients: v.allowed_clients || null, sort_order: volume.shares.length,
    }),
    onSuccess: invalidate,
  });
  const delShare = useMutation({ mutationFn: (id: string) => api.deleteShare(volume.id, id), onSuccess: invalidate });
  const [confirmDelVolume, setConfirmDelVolume] = useState(false);
  const delVolume = useMutation({
    mutationFn: () => api.deleteVolume(volume.array_id, volume.id),
    onSuccess: () => { setConfirmDelVolume(false); invalidate(); },
  });

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold text-[var(--color-text-primary)]">{volume.name}</h3>
        {canEdit && (
          <button className={dangerButtonClass} onClick={() => setConfirmDelVolume(true)} disabled={delVolume.isPending}>
            {delVolume.isPending && <Spinner />} Delete volume
          </button>
        )}
      </div>
      <ConfirmDialog open={confirmDelVolume} title="Delete volume" body={`Delete volume ${volume.name}?`}
        pending={delVolume.isPending}
        onConfirm={() => delVolume.mutate()}
        onCancel={() => setConfirmDelVolume(false)} />
      <div className="mt-3">
        <UsageBar pct={volume.used_pct} over={volume.over_threshold} />
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{volume.used_gb} / {volume.capacity_gb} GB</p>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">LUNs</h4>
          {canEdit && (
            <button type="button" className={secondaryButtonClass} onClick={() => setShowAddLun((v) => !v)}>
              {showAddLun ? 'Cancel' : '+ Add LUN'}
            </button>
          )}
        </div>
        {volume.luns.length === 0 ? <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">No LUNs.</p> : (
          <div className="mt-1 overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className={tableClass}>
              <thead>
                <tr className="text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className={tableCellClass}>Name</th><th className={tableCellClass}>Size (GB)</th><th className={tableCellClass}>Cluster</th><th className={tableCellClass}>Target IQN</th><th className={tableCellClass}>Status</th><th className={tableCellClass} />
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {volume.luns.map((l) => (
                  <tr key={l.id} className="transition-colors hover:bg-[var(--color-accent)]/5">
                    <td className={cn(tableCellClass, monoClass)}>{l.name}</td>
                    <td className={cn(tableCellClass, 'tabular-nums')}>{l.size_gb}</td>
                    <td className={tableCellClass}>{l.cluster ?? '—'}</td>
                    <td className={cn(tableCellClass, monoClass)}>{l.target_iqn ?? '—'}</td>
                    <td className={tableCellClass}>{l.status ?? '—'}</td>
                    <td className={tableCellClass}>{canEdit && <RemoveButton onClick={() => delLun.mutate(l.id)} label={`Remove LUN ${l.name}`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && showAddLun && (
          <InlineAddForm fields={[
            { name: 'name', placeholder: 'LUN name', required: true },
            { name: 'size_gb', placeholder: 'Size GB', type: 'number', required: true },
            { name: 'cluster', placeholder: 'Cluster', options: clusters },
            { name: 'target_iqn', placeholder: 'Target IQN' },
            { name: 'status', placeholder: 'Status' },
          ]} onSubmit={(v) => addLun.mutate(v)} pending={addLun.isPending} />
        )}
        {addLun.isError && <Alert>{detailMessage(addLun.error)}</Alert>}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">NFS shares</h4>
          {canEdit && (
            <button type="button" className={secondaryButtonClass} onClick={() => setShowAddShare((v) => !v)}>
              {showAddShare ? 'Cancel' : '+ Add share'}
            </button>
          )}
        </div>
        {volume.shares.length === 0 ? <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">No shares.</p> : (
          <div className="mt-1 overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className={tableClass}>
              <thead>
                <tr className="text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  <th className={tableCellClass}>Export path</th><th className={tableCellClass}>Used (GB)</th><th className={tableCellClass}>Allowed clients</th><th className={tableCellClass} />
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {volume.shares.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-[var(--color-accent)]/5">
                    <td className={cn(tableCellClass, monoClass)}>{s.export_path}</td>
                    <td className={cn(tableCellClass, 'tabular-nums')}>{s.used_gb ?? '—'}</td>
                    <td className={tableCellClass}>{s.allowed_clients ?? '—'}</td>
                    <td className={tableCellClass}>{canEdit && <RemoveButton onClick={() => delShare.mutate(s.id)} label={`Remove share ${s.export_path}`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && showAddShare && (
          <InlineAddForm fields={[
            { name: 'export_path', placeholder: 'Export path', required: true },
            { name: 'used_gb', placeholder: 'Used GB', type: 'number' },
            { name: 'allowed_clients', placeholder: 'Allowed clients' },
          ]} onSubmit={(v) => addShare.mutate(v)} pending={addShare.isPending} />
        )}
        {addShare.isError && <Alert>{detailMessage(addShare.error)}</Alert>}
      </div>
    </section>
  );
}

function VolumesArea({ array, clusters, canEdit }: { array: StorageArray; clusters: string[]; canEdit: boolean }) {
  const [showAddVolume, setShowAddVolume] = useState(false);
  const qc = useQueryClient();
  const addVolume = useMutation({
    mutationFn: (v: Record<string, string>) => api.addVolume(array.id, {
      name: v.name, capacity_gb: Number(v.capacity_gb) || 0, used_gb: Number(v.used_gb) || 0,
      sort_order: array.volumes.length,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['array', array.id] });
      qc.invalidateQueries({ queryKey: ['arrays'] });
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className={sectionTitleClass}>Volumes</h2>
        {canEdit && (
          <button type="button" className={secondaryButtonClass} onClick={() => setShowAddVolume((v) => !v)}>
            {showAddVolume ? 'Cancel' : '+ Add volume'}
          </button>
        )}
      </div>
      {array.volumes.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No volumes yet.</p> : null}
      {array.volumes.map((v) => <VolumePanel key={v.id} volume={v} clusters={clusters} canEdit={canEdit} />)}
      {canEdit && showAddVolume && (
        <div className="rounded-xl border border-dashed border-slate-200 p-4 dark:border-slate-700">
          <InlineAddForm fields={[
            { name: 'name', placeholder: 'Volume name', required: true },
            { name: 'capacity_gb', placeholder: 'Capacity GB', type: 'number', required: true },
            { name: 'used_gb', placeholder: 'Used GB', type: 'number' },
          ]} onSubmit={(v) => addVolume.mutate(v)} pending={addVolume.isPending} />
          {addVolume.isError && <Alert>{detailMessage(addVolume.error)}</Alert>}
        </div>
      )}
    </div>
  );
}

export function StorageDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';

  const arrayQ = useQuery({ queryKey: ['array', id], queryFn: () => api.getArray(id) });
  const optionsQ = useQuery({ queryKey: ['dropdown-options'], queryFn: () => api.getDropdownOptions() });
  const array = arrayQ.data;
  const clusters = optionsQ.data?.cluster ?? [];

  const deleteMut = useMutation({
    mutationFn: () => api.deleteArray(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arrays'] }); router.push('/storage'); },
  });

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateMut = useMutation({
    mutationFn: (payload: ArrayPayload) => api.updateArray(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['array', id] });
      qc.invalidateQueries({ queryKey: ['arrays'] });
      setEditing(false);
    },
  });

  if (arrayQ.isLoading) return <PageTransition><Skeleton className="h-64 w-full" /></PageTransition>;
  if (arrayQ.isError) return <PageTransition><Alert>{detailMessage(arrayQ.error)}</Alert></PageTransition>;
  if (!array) return null;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl space-y-5">
        <PageHeader title={array.name} eyebrow={array.vendor} actions={
          <>
            <button className={secondaryButtonClass} onClick={() => router.push('/storage')}>← Back</button>
            {canEdit && (
              <button className={dangerButtonClass}
                onClick={() => setConfirmDelete(true)}
                disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete array
              </button>
            )}
          </>
        } />

        <ConfirmDialog open={confirmDelete} title="Delete array"
          body={`Delete array ${array.name} and all its volumes? This cannot be undone.`}
          pending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setConfirmDelete(false)} />

        {deleteMut.isError && <Alert>{detailMessage(deleteMut.error)}</Alert>}

        <section className={cardClass}>
          <div className="flex items-center justify-between">
            <h2 className={sectionTitleClass}>Capacity</h2>
            {canEdit && !editing ? (
              <button className={primaryButtonClass} onClick={() => setEditing(true)}>Edit</button>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-4">
              <ArrayForm
                initial={{
                  name: array.name,
                  vendor: array.vendor,
                  model: array.model ?? '',
                  mgmt_host: array.mgmt_host ?? '',
                  datacenter: array.datacenter ?? '',
                  total_capacity_gb: String(array.total_capacity_gb),
                  used_capacity_gb: String(array.used_capacity_gb),
                  description: array.description ?? '',
                  notes: array.notes ?? '',
                } as Partial<ArrayFormValues>}
                onSubmit={(payload) => updateMut.mutate(payload)}
                onCancel={() => setEditing(false)}
                pending={updateMut.isPending}
                submitLabel="Save changes"
              />
              {updateMut.isError ? <Alert>{detailMessage(updateMut.error)}</Alert> : null}
            </div>
          ) : (
            <div className="mt-3">
              <UsageBar pct={array.used_pct} over={array.over_threshold} />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {array.used_capacity_gb} / {array.total_capacity_gb} GB
                {array.datacenter ? ` · ${array.datacenter}` : ''}
                {array.model ? ` · ${array.model}` : ''}
              </p>
            </div>
          )}
        </section>

        <VolumesArea array={array} clusters={clusters} canEdit={canEdit} />
      </section>
    </PageTransition>
  );
}
