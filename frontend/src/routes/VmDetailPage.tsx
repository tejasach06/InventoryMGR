'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, NetworkRole, Vm } from '../api/client';
import {
  Alert, Badge, ConfirmDialog, EmptyState, PageHeader, PageTransition, RemoveButton, SectionCard, SectionNav, Skeleton, Spinner,
  cardClass, dangerButtonClass, inputClass, labelClass, monoClass, secondaryButtonClass, selectClass,
} from '../components/ui';
import { cn } from '../lib/classNames';
import { useCurrentUser } from '../components/AuthContext';
import { formatMemory } from '../lib/units';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      aria-label={`${label}: ${text}`}
      title={`${label}: ${text}`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
    >
      {copied ? (
        <>
          <svg className="h-3 w-3 text-[var(--color-status-running)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6L5 8.5L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[var(--color-status-running)] font-semibold">Copied!</span>
        </>
      ) : (
        <>
          <svg className="h-3 w-3 opacity-60" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
            <path d="M2.5 8V2.5A1 1 0 0 1 3.5 1.5H8" strokeLinecap="round" />
          </svg>
          <span className="opacity-75">{label}</span>
        </>
      )}
    </button>
  );
}

function Field({
  label,
  value,
  mono = false,
  badgeType,
  copyable = false,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  mono?: boolean;
  badgeType?: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle';
  copyable?: boolean;
}) {
  const display = value === null || value === undefined || value === ''
    ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  const empty = display === '—';
  return (
    <div className="py-2">
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className={`mt-1 flex items-center gap-2 ${mono && !empty ? monoClass : ''} ${empty ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}`}>
        {badgeType && !empty ? <Badge value={String(value)} type={badgeType} size="md" /> : <span>{display}</span>}
        {copyable && !empty && typeof value === 'string' && <CopyButton text={value} />}
      </dd>
    </div>
  );
}


function HealthScore({ score }: { score: number }) {
  const colorVar = score >= 75 ? 'var(--color-status-running)' : score >= 50 ? 'var(--color-criticality-medium)' : 'var(--color-criticality-critical)';
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-surface-tertiary)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: colorVar }} />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-[var(--color-text-secondary)]">{score}%</span>
    </div>
  );
}

function AddRowForm({ fields, onSubmit, pending }: {
  fields: Array<{ name: string; placeholder: string; type?: string; options?: readonly string[] }>;
  onSubmit: (values: Record<string, string>) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, f.options?.[0] ?? '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  function submit() {
    onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
    setValues(blank());
  }
  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className={labelClass}>{f.placeholder}</span>
            {f.options ? (
              <select value={values[f.name]}
                onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))}
                className={selectClass}>
                {f.options.map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
              </select>
            ) : (
              <input type={f.type ?? 'text'} value={values[f.name]}
                onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                className={cn(inputClass, (f.type === 'number' || f.type === 'date') && 'tabular-nums')} />
            )}
          </label>
        ))}
      </div>
      <button type="button" onClick={submit} disabled={pending}
        className={`${secondaryButtonClass} mt-3`}>
        {pending ? <Spinner /> : null}+ Add
      </button>
    </div>
  );
}

function DisksPanel({ vm }: { vm: Vm }) {
  const qc = useQueryClient();
  const [deleteDiskId, setDeleteDiskId] = useState<string | null>(null);
  const addMut = useMutation({
    mutationFn: (v: Record<string, string>) => api.addDisk(vm.id, {
      disk_name: v.disk_name || `disk${vm.disks.length}`,
      storage_name: v.storage_name || null,
      size_gb: Number(v.size_gb) || 0,
      storage_type: v.storage_type || null,
      sort_order: vm.disks.length,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteDisk(vm.id, id),
    onSuccess: () => {
      setDeleteDiskId(null);
      qc.invalidateQueries({ queryKey: ['vm', vm.id] });
    },
  });
  const diskToDelete = vm.disks.find((d) => d.id === deleteDiskId);

  return (
    <div>
      {delMut.isError && <Alert>{detailMessage(delMut.error)}</Alert>}
      <ConfirmDialog
        open={Boolean(deleteDiskId)}
        title="Remove Disk"
        confirmLabel="Remove Disk"
        tone="danger"
        body={`Are you sure you want to remove ${diskToDelete?.disk_name ?? 'this disk'} (${diskToDelete?.size_gb ?? 0} GB) from ${vm.name}?`}
        pending={delMut.isPending}
        onConfirm={() => deleteDiskId && delMut.mutate(deleteDiskId)}
        onCancel={() => setDeleteDiskId(null)}
      />
      {vm.disks.length === 0 ? <EmptyState title="No disks configured" body="Add a disk below to start tracking storage for this VM." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead>
            <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
              <th className="pb-1 pr-4">Name</th><th className="pb-1 pr-4">Storage</th><th className="pb-1 pr-4">Size (GB)</th><th className="pb-1 pr-4">Type</th><th />
            </tr></thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {vm.disks.map((d) => (
                <tr key={d.id}>
                  <td className="py-1.5 pr-4 font-mono text-[var(--color-text-primary)]">{d.disk_name}</td>
                  <td className="py-1.5 pr-4 text-[var(--color-text-secondary)]">{d.storage_name ?? '—'}</td>
                  <td className="py-1.5 pr-4 tabular-nums text-[var(--color-text-primary)]">{d.size_gb}</td>
                  <td className="py-1.5 pr-4 text-[var(--color-text-secondary)]">{d.storage_type ?? '—'}</td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => setDeleteDiskId(d.id)}
                      className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] rounded transition-colors"
                      title={`Remove ${d.disk_name}`}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4h10M6 4V2.5h4V4M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddRowForm fields={[
        { name: 'disk_name', placeholder: 'Disk name (e.g. scsi0)' },
        { name: 'storage_name', placeholder: 'Storage' },
        { name: 'size_gb', placeholder: 'Size GB', type: 'number' },
        { name: 'storage_type', placeholder: 'Type' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <Alert>{detailMessage(addMut.error)}</Alert>}
    </div>
  );
}

function NetworksPanel({ vm }: { vm: Vm }) {
  const qc = useQueryClient();
  const [deleteNetworkId, setDeleteNetworkId] = useState<string | null>(null);
  const addMut = useMutation({
    mutationFn: (v: Record<string, string>) => api.addNetwork(vm.id, {
      ip_address: v.ip_address, role: (v.role as NetworkRole) || 'private',
      vlan: v.vlan ? Number(v.vlan) : null,
      gateway: v.gateway || null, sort_order: vm.networks.length,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteNetwork(vm.id, id),
    onSuccess: () => {
      setDeleteNetworkId(null);
      qc.invalidateQueries({ queryKey: ['vm', vm.id] });
    },
  });
  const netToDelete = vm.networks.find((n) => n.id === deleteNetworkId);

  return (
    <div>
      {delMut.isError && <Alert>{detailMessage(delMut.error)}</Alert>}
      <ConfirmDialog
        open={Boolean(deleteNetworkId)}
        title="Remove Network Entry"
        confirmLabel="Remove Network"
        tone="danger"
        body={`Are you sure you want to remove IP address ${netToDelete?.ip_address ?? 'entry'} from ${vm.name}?`}
        pending={delMut.isPending}
        onConfirm={() => deleteNetworkId && delMut.mutate(deleteNetworkId)}
        onCancel={() => setDeleteNetworkId(null)}
      />
      {vm.networks.length === 0 ? <EmptyState title="No network entries configured" body="Add an IP address below to start tracking network configuration." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead>
            <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
              <th className="pb-1 pr-4">IP Address</th><th className="pb-1 pr-4">Role</th><th className="pb-1 pr-4">VLAN</th><th className="pb-1 pr-4">Gateway</th><th />
            </tr></thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {vm.networks.map((n) => (
                <tr key={n.id}>
                  <td className="py-1.5 pr-4 font-mono text-[var(--color-text-primary)]">
                    <div className="flex items-center gap-1.5">
                      <span>{n.ip_address}</span>
                      <CopyButton text={n.ip_address} />
                    </div>
                  </td>
                  <td className="py-1.5 pr-4 capitalize text-[var(--color-text-secondary)]">{n.role}</td>
                  <td className="py-1.5 pr-4 font-mono tabular-nums text-[var(--color-text-secondary)]">{n.vlan ?? '—'}</td>
                  <td className="py-1.5 pr-4 font-mono text-[var(--color-text-secondary)]">{n.gateway ?? '—'}</td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => setDeleteNetworkId(n.id)}
                      className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] rounded transition-colors"
                      title={`Remove ${n.ip_address}`}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4h10M6 4V2.5h4V4M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddRowForm fields={[
        { name: 'ip_address', placeholder: 'IP address' },
        { name: 'role', placeholder: 'IP role', options: ['private', 'public', 'backup'] as const },
        { name: 'vlan', placeholder: 'VLAN', type: 'number' },
        { name: 'gateway', placeholder: 'Gateway' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <Alert>{detailMessage(addMut.error)}</Alert>}
    </div>
  );
}

function ApplicationsPanel({ vm }: { vm: Vm }) {
  const qc = useQueryClient();
  const [deleteAppId, setDeleteAppId] = useState<string | null>(null);
  const addMut = useMutation({
    mutationFn: (v: Record<string, string>) => api.addApplication(vm.id, {
      app_name: v.app_name, app_owner: null, description: v.description || null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteApplication(vm.id, id),
    onSuccess: () => {
      setDeleteAppId(null);
      qc.invalidateQueries({ queryKey: ['vm', vm.id] });
    },
  });
  const appToDelete = vm.applications.find((a) => a.id === deleteAppId);

  return (
    <div>
      {delMut.isError && <Alert>{detailMessage(delMut.error)}</Alert>}
      <ConfirmDialog
        open={Boolean(deleteAppId)}
        title="Remove Application"
        confirmLabel="Remove Application"
        tone="danger"
        body={`Are you sure you want to remove ${appToDelete?.app_name ?? 'this application'} from ${vm.name}?`}
        pending={delMut.isPending}
        onConfirm={() => deleteAppId && delMut.mutate(deleteAppId)}
        onCancel={() => setDeleteAppId(null)}
      />
      {vm.applications.length === 0 ? <EmptyState title="No applications linked" body="Add an application below to track what runs on this VM." /> : (
        <ul className="space-y-1">
          {vm.applications.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2">
              <div>
                <span className="font-medium text-[var(--color-text-primary)]">{a.app_name}</span>
                {a.description && <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{a.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => setDeleteAppId(a.id)}
                className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] rounded transition-colors"
                title={`Remove ${a.app_name}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 4h10M6 4V2.5h4V4M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddRowForm fields={[
        { name: 'app_name', placeholder: 'Application name' },
        { name: 'description', placeholder: 'Description' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <Alert>{detailMessage(addMut.error)}</Alert>}
    </div>
  );
}


function AuditPanel({ vmId }: { vmId: string }) {
  const auditQ = useQuery({ queryKey: ['audit', vmId], queryFn: () => api.getAuditLog(vmId) });
  if (auditQ.isLoading) return <Skeleton className="h-24" />;
  if (!auditQ.data?.length) return <EmptyState title="No changes recorded yet" body="Audit entries appear here as this VM's fields are edited." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm"><thead>
        <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
          <th className="pb-1 pr-4">Date</th><th className="pb-1 pr-4">User</th><th className="pb-1 pr-4">Field</th><th className="pb-1 pr-4">Old</th><th className="pb-1">New</th>
        </tr></thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {auditQ.data.map((e) => (
            <tr key={e.id}>
              <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-[var(--color-text-tertiary)]">{new Date(e.changed_at).toLocaleString()}</td>
              <td className="py-1.5 pr-4 text-[var(--color-text-primary)]">{e.user?.email ?? '—'}</td>
              <td className="py-1.5 pr-4 font-mono text-[var(--color-text-primary)]">{e.field_name}</td>
              <td className="max-w-xs truncate py-1.5 pr-4 text-[var(--color-text-secondary)]">{e.old_value ?? '—'}</td>
              <td className="max-w-xs truncate py-1.5 text-[var(--color-text-primary)]">{e.new_value ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VmDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();

  const vmQ = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id) });
  const vm = vmQ.data;

  const cloneMut = useMutation({
    mutationFn: () => api.cloneVm(id),
    onSuccess: (cloned) => { qc.setQueryData(['vm', cloned.id], cloned); router.push(`/inventory/${cloned.id}`); },
  });
  const deleteMut = useMutation({
    mutationFn: () => api.deleteVm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); router.push('/inventory'); },
  });
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const canDelete = user.role === 'admin';
  const [confirmClone, setConfirmClone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (vmQ.isLoading) return (
    <PageTransition>
      <div className="space-y-5" role="status" aria-label="Loading">
        <div className="flex items-center gap-3"><Skeleton className="h-7 w-48" /><Skeleton className="h-5 w-16" /></div>
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={cardClass + ' space-y-3'}>
            <Skeleton className="h-4 w-32" />
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((f) => <div key={f}><Skeleton className="mb-2 h-3 w-20" /><Skeleton className="h-4 w-32" /></div>)}
            </div>
          </div>
        ))}
      </div>
    </PageTransition>
  );
  if (vmQ.isError) return <PageTransition><Alert>{detailMessage(vmQ.error)}</Alert></PageTransition>;
  if (!vm) return null;

  const totalStorageGb = vm.disks?.reduce((acc, d) => acc + (d.size_gb || 0), 0) ?? 0;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl space-y-5 2xl:max-w-6xl">
        <PageHeader
          title={vm.name}
          eyebrow={<Badge value={vm.environment} type="environment" />}
          actions={
            <>
              <button className={secondaryButtonClass} onClick={() => router.push('/inventory')}>← Back</button>
              {canEdit && <Link className={secondaryButtonClass} href={`/inventory/${id}/edit`}>Edit</Link>}
              {canEdit && (
                <button className={secondaryButtonClass} onClick={() => setConfirmClone(true)} disabled={cloneMut.isPending}>
                  {cloneMut.isPending && <Spinner />} Clone
                </button>
              )}
              {canDelete && (
                <button className={dangerButtonClass} onClick={() => setConfirmDelete(true)} disabled={deleteMut.isPending}>
                  {deleteMut.isPending && <Spinner />} Delete
                </button>
              )}
            </>
          }
        />

        {(cloneMut.isError || deleteMut.isError) && <Alert>{detailMessage(cloneMut.error ?? deleteMut.error)}</Alert>}

        <ConfirmDialog open={confirmClone} title="Clone VM" confirmLabel="Clone VM" tone="primary"
          body={`Create a copy of "${vm.name}" with matching hardware, network, and OS parameters? You will be taken to the new record upon creation.`}
          pending={cloneMut.isPending}
          onConfirm={() => cloneMut.mutate()}
          onCancel={() => setConfirmClone(false)} />

        <ConfirmDialog open={confirmDelete} title="Delete VM" confirmLabel="Delete VM" tone="danger"
          body={`Delete VM ${vm.name}? This cannot be undone.`}
          pending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setConfirmDelete(false)} />

        <SectionNav titles={['Telemetry', 'Infrastructure', 'Operations', 'Audit & History']} />

        {/* 1. HERO TELEMETRY PANEL */}
        <section id="telemetry" className="rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge value={vm.status} type="status" size="md" />
              <Badge value={vm.platform} type="platform" size="md" />
              <Badge value={vm.environment} type="environment" size="md" />
              <Badge value={vm.criticality} type="criticality" size="md" />
              {vm.lifecycle && <Badge value={vm.lifecycle} type="lifecycle" size="md" />}
              {vm.os_family && <Badge value={vm.os_family} type="os_family" size="md" />}
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Health Score</span>
              <div className="flex-1 sm:w-48">
                <HealthScore score={vm.health_score} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-[var(--color-surface-secondary)] p-3">
              <p className="eyebrow-label text-[0.625rem]">Primary IP</p>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className={`${monoClass} text-sm font-semibold text-[var(--color-text-primary)]`}>
                  {vm.networks?.find((n) => n.role === 'private')?.ip_address ?? vm.networks?.[0]?.ip_address ?? '—'}
                </span>
                {(vm.networks?.find((n) => n.role === 'private')?.ip_address ?? vm.networks?.[0]?.ip_address) && (
                  <CopyButton text={vm.networks?.find((n) => n.role === 'private')?.ip_address ?? vm.networks?.[0]?.ip_address ?? ''} label="Copy IP" />
                )}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-secondary)] p-3">
              <p className="eyebrow-label text-[0.625rem]">FQDN</p>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className={`${monoClass} text-sm font-semibold text-[var(--color-text-primary)] truncate`}>
                  {vm.fqdn ?? '—'}
                </span>
                {vm.fqdn && <CopyButton text={vm.fqdn} label="Copy FQDN" />}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-secondary)] p-3">
              <p className="eyebrow-label text-[0.625rem]">vCPU, Memory & Storage</p>
              <p className={`${monoClass} mt-1 text-sm font-semibold text-[var(--color-text-primary)]`}>
                {vm.cpu_cores} vCPU · {vm.memory_mb ? formatMemory(vm.memory_mb) : '—'}{totalStorageGb ? ` · ${totalStorageGb} GB` : ''}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-secondary)] p-3">
              <p className="eyebrow-label text-[0.625rem]">Location / Host</p>
              <p className={`${monoClass} mt-1 text-sm font-semibold text-[var(--color-text-primary)] truncate`}>
                {vm.cluster ?? '—'}{vm.node ? ` / ${vm.node}` : ''}
              </p>
            </div>
          </div>
        </section>

        {/* 2-COLUMN BENTO GRID FOR SECONDARY DETAILS */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* LEFT COLUMN: INFRASTRUCTURE & OPERATIONS */}
          <div className="space-y-5">
            <section id="infrastructure">
              <SectionCard title="General & Hardware Information">
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <Field label="Hostname" value={vm.name} copyable />
                  <Field label="FQDN" value={vm.fqdn} mono copyable />
                  <Field label="VM ID" value={vm.external_id} mono copyable />
                  <Field label="SR-ID" value={vm.sr_id} mono copyable />
                  <Field label="Datacenter" value={vm.datacenter} />
                  <Field label="Cluster / Node" value={`${vm.cluster ?? '—'} / ${vm.node ?? '—'}`} mono />
                  <Field label="vCPU Cores" value={vm.cpu_cores} mono />
                  <Field label="Memory" value={vm.memory_mb ? formatMemory(vm.memory_mb) : null} mono />
                  <Field label="Tags" value={vm.tags.join(', ') || null} />
                  {vm.description && (
                    <div className="sm:col-span-2 py-2">
                      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Description</dt>
                      <dd className="mt-1 text-sm text-[var(--color-text-primary)]">{vm.description}</dd>
                    </div>
                  )}
                </dl>
              </SectionCard>
            </section>

            <SectionCard title="Storage Configuration">
              <DisksPanel vm={vm} />
            </SectionCard>

            <SectionCard title="Network Configuration">
              <NetworksPanel vm={vm} />
            </SectionCard>
          </div>

          {/* RIGHT COLUMN: GOVERNANCE, SECURITY & AUDIT */}
          <div className="space-y-5">
            <section id="operations">
              <SectionCard title="Ownership & Governance">
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <Field label="Owner" value={vm.owner} />
                  <Field label="Business Owner" value={vm.business_owner} />
                  <Field label="Technical Owner" value={vm.technical_owner} />
                  <Field label="OS Family" value={vm.os_family ? vm.os_family.charAt(0).toUpperCase() + vm.os_family.slice(1) : null} badgeType="os_family" />
                  <Field label="OS Name" value={vm.os_name} />
                  <Field label="Distribution / Version" value={`${vm.os_distribution ?? '—'} ${vm.os_version ?? ''}`} />
                </dl>
              </SectionCard>
            </section>

            <SectionCard title="Applications & Verification">
              <ApplicationsPanel vm={vm} />
            </SectionCard>

            <SectionCard title="Operational Controls & Security">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Field label="Monitoring Enabled" value={vm.monitoring_enabled} />
                <Field label="Backup Enabled" value={vm.backup_enabled} />
                <Field label="Backup Location" value={vm.backup_location} />
                <Field label="HA Enabled" value={vm.ha_enabled} />
                <Field label="PMP Access" value={vm.pmp_enabled} />
                <Field label="VM Type" value={vm.vm_type} />
                <Field label="Last Verified" value={vm.last_verified_at} />
                <Field label="Decommission Date" value={vm.decommission_date} />
                <Field label="Last Patch Date" value={vm.last_patch_date} />
                <Field label="Last Vuln Scan" value={vm.last_vuln_scan_date} />
              </dl>
            </SectionCard>

            <section id="audit-history">
              <SectionCard title="Audit History">
                <AuditPanel vmId={vm.id} />
              </SectionCard>
            </section>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
