'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, NetworkRole, Vm } from '../api/client';
import {
  Alert, Badge, EmptyState, PageHeader, PageTransition, RemoveButton, SectionCard, Skeleton, Spinner,
  cardClass, dangerButtonClass, inputClass, labelClass, monoClass, secondaryButtonClass, selectClass,
} from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { formatMemory } from '../lib/units';

function Field({ label, value, mono = false }: { label: string; value: string | number | boolean | null | undefined; mono?: boolean }) {
  const display = value === null || value === undefined || value === ''
    ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  const empty = display === '—';
  return (
    <div className="py-2">
      <dt className={`text-[0.7rem] font-medium uppercase tracking-[0.08em] ${labelClass}`}>{label}</dt>
      <dd className={`mt-1 ${mono && !empty ? monoClass : ''} ${empty ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]'}`}>{display}</dd>
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
                className={inputClass} />
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  return (
    <div>
      {vm.disks.length === 0 ? <EmptyState text="No disks configured." /> : (
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
                <td className="py-1.5"><RemoveButton onClick={() => delMut.mutate(d.id)} label={`Remove ${d.disk_name}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddRowForm fields={[
        { name: 'disk_name', placeholder: 'Disk name (e.g. scsi0)' },
        { name: 'storage_name', placeholder: 'Storage' },
        { name: 'size_gb', placeholder: 'Size GB', type: 'number' },
        { name: 'storage_type', placeholder: 'Type' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addMut.error)}</p>}
    </div>
  );
}

function NetworksPanel({ vm }: { vm: Vm }) {
  const qc = useQueryClient();
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  return (
    <div>
      {vm.networks.length === 0 ? <EmptyState text="No network entries configured." /> : (
        <table className="w-full text-sm"><thead>
          <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
            <th className="pb-1 pr-4">IP Address</th><th className="pb-1 pr-4">Role</th><th className="pb-1 pr-4">VLAN</th><th className="pb-1 pr-4">Gateway</th><th />
          </tr></thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {vm.networks.map((n) => (
              <tr key={n.id}>
                <td className="py-1.5 pr-4 font-mono text-[var(--color-text-primary)]">{n.ip_address}</td>
                <td className="py-1.5 pr-4 capitalize text-[var(--color-text-secondary)]">{n.role}</td>
                <td className="py-1.5 pr-4 tabular-nums text-[var(--color-text-secondary)]">{n.vlan ?? '—'}</td>
                <td className="py-1.5 pr-4 font-mono text-[var(--color-text-secondary)]">{n.gateway ?? '—'}</td>
                <td className="py-1.5"><RemoveButton onClick={() => delMut.mutate(n.id)} label={`Remove ${n.ip_address}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddRowForm fields={[
        { name: 'ip_address', placeholder: 'IP address' },
        { name: 'role', placeholder: 'IP role', options: ['private', 'public', 'backup'] as const },
        { name: 'vlan', placeholder: 'VLAN', type: 'number' },
        { name: 'gateway', placeholder: 'Gateway' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addMut.error)}</p>}
    </div>
  );
}

function ApplicationsPanel({ vm }: { vm: Vm }) {
  const qc = useQueryClient();
  const addMut = useMutation({
    mutationFn: (v: Record<string, string>) => api.addApplication(vm.id, {
      app_name: v.app_name, app_owner: null, description: v.description || null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteApplication(vm.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vm', vm.id] }),
  });
  return (
    <div>
      {vm.applications.length === 0 ? <EmptyState text="No applications linked." /> : (
        <ul className="space-y-1">
          {vm.applications.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2">
              <div>
                <span className="font-medium text-[var(--color-text-primary)]">{a.app_name}</span>
                {a.description && <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{a.description}</p>}
              </div>
              <RemoveButton onClick={() => delMut.mutate(a.id)} label={`Remove ${a.app_name}`} />
            </li>
          ))}
        </ul>
      )}
      <AddRowForm fields={[
        { name: 'app_name', placeholder: 'Application name' },
        { name: 'description', placeholder: 'Description' },
      ]} onSubmit={(v) => addMut.mutate(v)} pending={addMut.isPending} />
      {addMut.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addMut.error)}</p>}
    </div>
  );
}

function AuditPanel({ vmId }: { vmId: string }) {
  const auditQ = useQuery({ queryKey: ['audit', vmId], queryFn: () => api.getAuditLog(vmId) });
  if (auditQ.isLoading) return <Skeleton className="h-24" />;
  if (!auditQ.data?.length) return <EmptyState text="No changes recorded yet." />;
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

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl space-y-5 2xl:max-w-6xl">
        <PageHeader title={vm.name} eyebrow={vm.environment} actions={
          <>
            <Badge value={vm.status} />
            <Badge value={vm.platform} />
            <button className={secondaryButtonClass} onClick={() => router.push('/inventory')}>← Back</button>
            {canEdit && <Link className={secondaryButtonClass} href={`/inventory/${id}/edit`}>Edit</Link>}
            {canEdit && (
              <button className={secondaryButtonClass} onClick={() => cloneMut.mutate()} disabled={cloneMut.isPending}>
                {cloneMut.isPending && <Spinner />} Clone
              </button>
            )}
            {canDelete && (
              <button className={dangerButtonClass} onClick={() => { if (confirm(`Delete VM ${vm.name}? This cannot be undone.`)) deleteMut.mutate(); }} disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete
              </button>
            )}
          </>
        } />

        {(cloneMut.isError || deleteMut.isError) && <Alert>{detailMessage(cloneMut.error ?? deleteMut.error)}</Alert>}

        <SectionCard title="Documentation Health Score">
          <HealthScore score={vm.health_score} />
        </SectionCard>

        <SectionCard title="General Information">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Hostname" value={vm.name} />
            <Field label="FQDN" value={vm.fqdn} />
            <Field label="Environment" value={vm.environment} />
            <Field label="Criticality" value={vm.criticality} />
            <Field label="Lifecycle" value={vm.lifecycle} />
            <Field label="Tags" value={vm.tags.join(', ') || null} />
            {vm.description && <div className="sm:col-span-2 xl:col-span-3 py-2">
              <dt className={`text-xs font-medium uppercase tracking-wide ${labelClass}`}>Description</dt>
              <dd className="mt-1 text-[var(--color-text-primary)]">{vm.description}</dd>
            </div>}
          </dl>
        </SectionCard>

        <SectionCard title="Location">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Platform" value={vm.platform} />
            <Field label="Datacenter" value={vm.datacenter} />
            <Field label="Cluster" value={vm.cluster} />
            <Field label="Node" value={vm.node} />
            <Field label="VM ID" value={vm.external_id} />
            <Field label="SR-ID" value={vm.sr_id} />
          </dl>
        </SectionCard>

        <SectionCard title="Hardware">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="vCPU" value={`${vm.cpu_cores} cores`} mono />
            <Field label="Memory" value={vm.memory_mb ? formatMemory(vm.memory_mb) : null} mono />
          </dl>
        </SectionCard>

        <SectionCard title="Storage"><DisksPanel vm={vm} /></SectionCard>
        <SectionCard title="Network">
          <dl className="mb-4 grid gap-x-8 gap-y-1 border-b border-slate-100 pb-2 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="IP addresses" value={vm.networks.map((n) => n.ip_address).join(', ') || null} mono />
          </dl>
          <NetworksPanel vm={vm} />
        </SectionCard>

        <SectionCard title="Operating System">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="OS Family" value={vm.os_family ? vm.os_family.charAt(0).toUpperCase() + vm.os_family.slice(1) : null} />
            <Field label="OS Name" value={vm.os_name} />
            <Field label="Distribution" value={vm.os_distribution} />
            <Field label="Version" value={vm.os_version} />
          </dl>
        </SectionCard>

        <SectionCard title="Ownership">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Owner" value={vm.owner} />
            <Field label="Business Owner" value={vm.business_owner} />
            <Field label="Technical Owner" value={vm.technical_owner} />
          </dl>
        </SectionCard>

        <SectionCard title="Applications"><ApplicationsPanel vm={vm} /></SectionCard>

        <SectionCard title="Monitoring">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Monitoring Enabled" value={vm.monitoring_enabled} />
            <Field label="Backup Enabled" value={vm.backup_enabled} />
            <Field label="Backup Location" value={vm.backup_location} />
            <Field label="HA Enabled" value={vm.ha_enabled} />
            <Field label="PMP Access" value={vm.pmp_enabled} />
          </dl>
        </SectionCard>

        <SectionCard title="Security">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Last Patch Date" value={vm.last_patch_date} />
            <Field label="Last Vuln Scan" value={vm.last_vuln_scan_date} />
            <Field label="Remarks" value={vm.security_remarks} />
          </dl>
        </SectionCard>

        <SectionCard title="Record">
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="VM Type" value={vm.vm_type} />
            <Field label="Last Verified" value={vm.last_verified_at} />
            <Field label="Decommission Date" value={vm.decommission_date} />
            <Field label="Created" value={new Date(vm.created_at).toLocaleDateString()} />
            <Field label="Last Updated" value={new Date(vm.updated_at).toLocaleDateString()} />
          </dl>
        </SectionCard>

        <SectionCard title="Audit Log"><AuditPanel vmId={vm.id} /></SectionCard>
      </section>
    </PageTransition>
  );
}
