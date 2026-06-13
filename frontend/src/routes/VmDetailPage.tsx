'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { Alert, Badge, PageHeader, cardClass, dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '../components/ui';

function DetailItem({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
    </div>
  );
}

export function VmDetailPage() {
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const canDelete = user.role === 'admin';
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const vm = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id), enabled: Boolean(id) });
  const remove = useMutation({
    mutationFn: () => api.deleteVm(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      router.push('/inventory');
    },
  });

  function confirmDelete() {
    if (!vm.data) return;
    if (window.confirm(`Delete VM ${vm.data.name}? This cannot be undone.`)) {
      remove.mutate();
    }
  }

  if (vm.isLoading) return <div className="p-6" role="status">Loading VM…</div>;
  if (vm.isError) return <Alert>{detailMessage(vm.error)}</Alert>;
  if (!vm.data) return <Alert>VM not found.</Alert>;

  return (
    <section>
      <PageHeader
        title={vm.data.name}
        eyebrow={`${vm.data.platform} / ${vm.data.environment}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link className={secondaryButtonClass} href="/inventory">Back</Link>
            {canEdit ? <Link className={primaryButtonClass} href={`/inventory/${vm.data.id}/edit`}>Edit</Link> : null}
            {canDelete ? <button type="button" className={dangerButtonClass} onClick={confirmDelete} disabled={remove.isPending}>Delete</button> : null}
          </div>
        )}
      />
      {remove.isError ? <Alert>{detailMessage(remove.error)}</Alert> : null}
      <div className={cardClass}>
        <div className="mb-5 flex flex-wrap gap-2"><Badge value={vm.data.status} /><Badge value={vm.data.criticality} /><Badge value={vm.data.lifecycle} /></div>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DetailItem label="External ID" value={vm.data.external_id} />
          <DetailItem label="Datacenter" value={vm.data.datacenter} />
          <DetailItem label="Cluster" value={vm.data.cluster} />
          <DetailItem label="Host" value={vm.data.host} />
          <DetailItem label="CPU cores" value={vm.data.cpu_cores} />
          <DetailItem label="Memory" value={`${vm.data.memory_mb} MB`} />
          <DetailItem label="Disk" value={`${vm.data.disk_gb} GB`} />
          <DetailItem label="Operating system" value={vm.data.os_name} />
          <DetailItem label="IP addresses" value={vm.data.ip_addresses.join(', ')} />
          <DetailItem label="Owner" value={vm.data.owner} />
          <DetailItem label="Backup status" value={vm.data.backup_status} />
          <DetailItem label="HA enabled" value={vm.data.ha_enabled ? 'Yes' : 'No'} />
          <DetailItem label="DR tier" value={vm.data.dr_tier} />
          <DetailItem label="Tags" value={vm.data.tags.join(', ')} />
          <DetailItem label="Last verified" value={vm.data.last_verified_at} />
          <DetailItem label="Updated" value={new Date(vm.data.updated_at).toLocaleString()} />
        </dl>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{vm.data.notes ?? 'No notes recorded.'}</p>
        </div>
      </div>
    </section>
  );
}
