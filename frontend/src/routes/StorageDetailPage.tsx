'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, ArrayPayload, StorageArray, StorageVolume } from '../api/client';
import {
  Alert, PageHeader, PageTransition, Skeleton, Spinner,
  dangerButtonClass, primaryButtonClass, secondaryButtonClass, sectionTitleClass,
} from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ArrayForm } from '../components/ArrayForm';
import type { ArrayFormValues } from '../components/ArrayForm';

interface FieldDef {
  name: string;
  placeholder: string;
  type?: string;
  options?: readonly string[];
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400">
      ×
    </button>
  );
}

function InlineAddForm({ fields, onSubmit, pending }: {
  fields: FieldDef[];
  onSubmit: (values: Record<string, string>) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  const inputClass = 'min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400';
  function submit() {
    onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
    setValues(blank());
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      {fields.map((f) => (
        f.options ? (
          <select key={f.name} aria-label={f.placeholder} value={values[f.name]}
            onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))} className={inputClass}>
            <option value="">{f.placeholder}</option>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input key={f.name} type={f.type ?? 'text'} placeholder={f.placeholder} value={values[f.name]}
            aria-label={f.placeholder}
            onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))} className={inputClass} />
        )
      ))}
      <button type="button" onClick={submit} disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
        {pending ? <Spinner /> : null}+ Add
      </button>
    </div>
  );
}

function UsageBar({ pct, over }: { pct: number | null; over: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct === null ? 0 : Math.min(100, pct)}%` }} />
      </div>
      <span className="w-14 text-right text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

function VolumePanel({ volume, clusters, canEdit }: { volume: StorageVolume; clusters: string[]; canEdit: boolean }) {
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
  const delVolume = useMutation({ mutationFn: () => api.deleteVolume(volume.array_id, volume.id), onSuccess: invalidate });

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{volume.name}</h3>
        {canEdit && (
          <button className={dangerButtonClass} onClick={() => { if (confirm(`Delete volume ${volume.name}?`)) delVolume.mutate(); }} disabled={delVolume.isPending}>
            {delVolume.isPending && <Spinner />} Delete volume
          </button>
        )}
      </div>
      <div className="mt-3">
        <UsageBar pct={volume.used_pct} over={volume.over_threshold} />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{volume.used_gb} / {volume.capacity_gb} GB</p>
      </div>

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">LUNs</h4>
        {volume.luns.length === 0 ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No LUNs.</p> : (
          <table className="mt-1 w-full text-sm"><thead>
            <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
              <th className="pb-1 pr-4">Name</th><th className="pb-1 pr-4">Size (GB)</th><th className="pb-1 pr-4">Cluster</th><th className="pb-1 pr-4">Target IQN</th><th className="pb-1 pr-4">Status</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {volume.luns.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-4 font-mono text-slate-700 dark:text-slate-300">{l.name}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{l.size_gb}</td>
                  <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{l.cluster ?? '—'}</td>
                  <td className="py-1.5 pr-4 font-mono text-slate-600 dark:text-slate-400">{l.target_iqn ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{l.status ?? '—'}</td>
                  <td className="py-1.5">{canEdit && <RemoveButton onClick={() => delLun.mutate(l.id)} label={`Remove LUN ${l.name}`} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <InlineAddForm fields={[
            { name: 'name', placeholder: 'LUN name' },
            { name: 'size_gb', placeholder: 'Size GB', type: 'number' },
            { name: 'cluster', placeholder: 'Cluster', options: clusters },
            { name: 'target_iqn', placeholder: 'Target IQN' },
            { name: 'status', placeholder: 'Status' },
          ]} onSubmit={(v) => addLun.mutate(v)} pending={addLun.isPending} />
        )}
        {addLun.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addLun.error)}</p>}
      </div>

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">NFS shares</h4>
        {volume.shares.length === 0 ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No shares.</p> : (
          <table className="mt-1 w-full text-sm"><thead>
            <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
              <th className="pb-1 pr-4">Export path</th><th className="pb-1 pr-4">Used (GB)</th><th className="pb-1 pr-4">Allowed clients</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {volume.shares.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-4 font-mono text-slate-700 dark:text-slate-300">{s.export_path}</td>
                  <td className="py-1.5 pr-4 tabular-nums text-slate-600 dark:text-slate-400">{s.used_gb ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{s.allowed_clients ?? '—'}</td>
                  <td className="py-1.5">{canEdit && <RemoveButton onClick={() => delShare.mutate(s.id)} label={`Remove share ${s.export_path}`} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <InlineAddForm fields={[
            { name: 'export_path', placeholder: 'Export path' },
            { name: 'used_gb', placeholder: 'Used GB', type: 'number' },
            { name: 'allowed_clients', placeholder: 'Allowed clients' },
          ]} onSubmit={(v) => addShare.mutate(v)} pending={addShare.isPending} />
        )}
        {addShare.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addShare.error)}</p>}
      </div>
    </section>
  );
}

function VolumesArea({ array, clusters, canEdit }: { array: StorageArray; clusters: string[]; canEdit: boolean }) {
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
      </div>
      {array.volumes.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No volumes yet.</p> : null}
      {array.volumes.map((v) => <VolumePanel key={v.id} volume={v} clusters={clusters} canEdit={canEdit} />)}
      {canEdit && (
        <div className="rounded-xl border border-dashed border-slate-200 p-4 dark:border-slate-700">
          <InlineAddForm fields={[
            { name: 'name', placeholder: 'Volume name' },
            { name: 'capacity_gb', placeholder: 'Capacity GB', type: 'number' },
            { name: 'used_gb', placeholder: 'Used GB', type: 'number' },
          ]} onSubmit={(v) => addVolume.mutate(v)} pending={addVolume.isPending} />
          {addVolume.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addVolume.error)}</p>}
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
                onClick={() => { if (confirm(`Delete array ${array.name} and all its volumes? This cannot be undone.`)) deleteMut.mutate(); }}
                disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete array
              </button>
            )}
          </>
        } />

        {deleteMut.isError && <Alert>{detailMessage(deleteMut.error)}</Alert>}

        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
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
              {updateMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(updateMut.error)}</p> : null}
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
