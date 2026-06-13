import { FormEvent, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api, detailMessage, User, Vm } from '../api/client';
import { Alert, Badge, EmptyState, PageHeader } from '../components/ui';

const filterNames = ['q', 'platform', 'environment', 'status', 'criticality', 'lifecycle'] as const;

type FilterName = (typeof filterNames)[number];
type Filters = Record<FilterName, string>;

function paramsFromFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const value = filters[name].trim();
    if (value.length > 0) params.set(name, value);
  }
  params.set('limit', '50');
  params.set('offset', '0');
  return params;
}

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    q: params.get('q') ?? '',
    platform: params.get('platform') ?? '',
    environment: params.get('environment') ?? '',
    status: params.get('status') ?? '',
    criticality: params.get('criticality') ?? '',
    lifecycle: params.get('lifecycle') ?? '',
  };
}

function VmTable({ vms }: { vms: Vm[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Platform</th>
            <th scope="col">Environment</th>
            <th scope="col">Cluster</th>
            <th scope="col">Host</th>
            <th scope="col">Status</th>
            <th scope="col">CPU</th>
            <th scope="col">Memory</th>
            <th scope="col">Disk</th>
            <th scope="col">Backup</th>
            <th scope="col">HA</th>
            <th scope="col">Criticality</th>
            <th scope="col">Lifecycle</th>
            <th scope="col">Owner</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {vms.map((vm) => (
            <tr key={vm.id}>
              <th scope="row"><Link to={`/inventory/${vm.id}`}>{vm.name}</Link></th>
              <td>{vm.platform}</td>
              <td>{vm.environment}</td>
              <td>{vm.cluster}</td>
              <td>{vm.host}</td>
              <td><Badge value={vm.status} /></td>
              <td>{vm.cpu_cores}</td>
              <td>{vm.memory_mb} MB</td>
              <td>{vm.disk_gb} GB</td>
              <td>{vm.backup_status ?? '—'}</td>
              <td>{vm.ha_enabled ? 'Yes' : 'No'}</td>
              <td><Badge value={vm.criticality} /></td>
              <td>{vm.lifecycle}</td>
              <td>{vm.owner ?? '—'}</td>
              <td>{new Date(vm.updated_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const { user } = useOutletContext<{ user: User }>();
  const canCreateVm = user.role === 'editor' || user.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams));
  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams)), [searchParams]);
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchParams(paramsFromFilters(filters));
  }

  return (
    <section>
      <PageHeader title="Inventory" actions={canCreateVm ? <Link className="button" to="/inventory/new">New VM</Link> : undefined} />
      <form className="card filters" onSubmit={submit}>
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Name, owner, host" />
        </div>
        <div className="field">
          <label htmlFor="platform">Platform</label>
          <select id="platform" name="platform" value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
            <option value="">All platforms</option><option value="proxmox">proxmox</option><option value="vmware">vmware</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="environment">Environment</label>
          <input id="environment" name="environment" value={filters.environment} onChange={(event) => setFilters({ ...filters, environment: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All statuses</option><option value="running">running</option><option value="stopped">stopped</option><option value="suspended">suspended</option><option value="unknown">unknown</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="criticality">Criticality</label>
          <select id="criticality" name="criticality" value={filters.criticality} onChange={(event) => setFilters({ ...filters, criticality: event.target.value })}>
            <option value="">All criticalities</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="lifecycle">Lifecycle</label>
          <select id="lifecycle" name="lifecycle" value={filters.lifecycle} onChange={(event) => setFilters({ ...filters, lifecycle: event.target.value })}>
            <option value="">All lifecycles</option><option value="planned">planned</option><option value="active">active</option><option value="retiring">retiring</option><option value="retired">retired</option>
          </select>
        </div>
        <div className="filter-actions"><button type="submit">Apply filters</button></div>
      </form>
      {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
      {vms.isLoading ? <div className="loading" role="status">Loading inventory…</div> : null}
      {vms.data && vms.data.items.length > 0 ? <VmTable vms={vms.data.items} /> : null}
      {vms.data && vms.data.items.length === 0 ? <EmptyState title="No VMs found" body="Create a VM or adjust the filters to see inventory." /> : null}
    </section>
  );
}
