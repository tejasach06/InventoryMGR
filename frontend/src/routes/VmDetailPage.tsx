import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, detailMessage, User } from '../api/client';
import { Alert, Badge, PageHeader } from '../components/ui';

function DetailItem({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
    </div>
  );
}

export function VmDetailPage() {
  const { user } = useOutletContext<{ user: User }>();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const canDelete = user.role === 'admin';
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const vm = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id ?? ''), enabled: Boolean(id) });
  const remove = useMutation({
    mutationFn: () => api.deleteVm(id ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      navigate('/inventory');
    },
  });

  function confirmDelete() {
    if (!vm.data) return;
    if (window.confirm(`Delete VM ${vm.data.name}? This cannot be undone.`)) {
      remove.mutate();
    }
  }

  if (vm.isLoading) return <div className="loading" role="status">Loading VM…</div>;
  if (vm.isError) return <Alert>{detailMessage(vm.error)}</Alert>;
  if (!vm.data) return <Alert>VM not found.</Alert>;

  return (
    <section>
      <PageHeader
        title={vm.data.name}
        eyebrow={`${vm.data.platform} / ${vm.data.environment}`}
        actions={(
          <div className="button-row">
            <Link className="secondary" to="/inventory">Back</Link>
            {canEdit ? <Link className="button" to={`/inventory/${vm.data.id}/edit`}>Edit</Link> : null}
            {canDelete ? <button type="button" className="danger" onClick={confirmDelete} disabled={remove.isPending}>Delete</button> : null}
          </div>
        )}
      />
      {remove.isError ? <Alert>{detailMessage(remove.error)}</Alert> : null}
      <div className="card detail-card">
        <div className="detail-status"><Badge value={vm.data.status} /><Badge value={vm.data.criticality} /><Badge value={vm.data.lifecycle} /></div>
        <dl className="detail-grid">
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
        <div className="notes-block">
          <h2>Notes</h2>
          <p>{vm.data.notes ?? 'No notes recorded.'}</p>
        </div>
      </div>
    </section>
  );
}
