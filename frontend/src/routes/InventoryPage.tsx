'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { Alert, Badge, EmptyState, PageHeader, cardClass, inputClass, primaryButtonClass, selectClass, tableWrapClass } from '../components/ui';

const filterNames = ['q', 'platform', 'environment', 'status', 'criticality', 'lifecycle'] as const;

type FilterName = (typeof filterNames)[number];
type Filters = Record<FilterName, string>;

type ParamReader = Pick<URLSearchParams, 'get' | 'toString'>;

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

function filtersFromParams(params: ParamReader): Filters {
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
    <div className={tableWrapClass}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3" scope="col">Name</th>
            <th className="px-4 py-3" scope="col">Platform</th>
            <th className="px-4 py-3" scope="col">Environment</th>
            <th className="px-4 py-3" scope="col">Cluster</th>
            <th className="px-4 py-3" scope="col">Host</th>
            <th className="px-4 py-3" scope="col">Status</th>
            <th className="px-4 py-3" scope="col">CPU</th>
            <th className="px-4 py-3" scope="col">Memory</th>
            <th className="px-4 py-3" scope="col">Disk</th>
            <th className="px-4 py-3" scope="col">Backup</th>
            <th className="px-4 py-3" scope="col">HA</th>
            <th className="px-4 py-3" scope="col">Criticality</th>
            <th className="px-4 py-3" scope="col">Lifecycle</th>
            <th className="px-4 py-3" scope="col">Owner</th>
            <th className="px-4 py-3" scope="col">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {vms.map((vm) => (
            <tr key={vm.id} className="transition hover:bg-slate-50/80">
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-blue-700" scope="row"><Link className="hover:text-blue-900 hover:underline" href={`/inventory/${vm.id}`}>{vm.name}</Link></th>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.platform}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.environment}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.cluster}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.host}</td>
              <td className="whitespace-nowrap px-4 py-3"><Badge value={vm.status} /></td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.cpu_cores}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.memory_mb} MB</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.disk_gb} GB</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.backup_status ?? '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.ha_enabled ? 'Yes' : 'No'}</td>
              <td className="whitespace-nowrap px-4 py-3"><Badge value={vm.criticality} /></td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.lifecycle}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{vm.owner ?? '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-700">{new Date(vm.updated_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canCreateVm = user.role === 'editor' || user.role === 'admin';
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams));
  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams)), [searchParams]);
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
  }, [searchParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = paramsFromFilters(filters);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <section>
      <PageHeader title="Inventory" actions={canCreateVm ? <Link className={primaryButtonClass} href="/inventory/new">New VM</Link> : undefined} />
      <form className={cardClass + ' mb-6 grid gap-4 lg:grid-cols-6'} onSubmit={submit}>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="q">Search</label>
          <input className={inputClass} id="q" name="q" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Name, owner, host" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="platform">Platform</label>
          <select className={selectClass} id="platform" name="platform" value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
            <option value="">All platforms</option><option value="proxmox">proxmox</option><option value="vmware">vmware</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="environment">Environment</label>
          <input className={inputClass} id="environment" name="environment" value={filters.environment} onChange={(event) => setFilters({ ...filters, environment: event.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="status">Status</label>
          <select className={selectClass} id="status" name="status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All statuses</option><option value="running">running</option><option value="stopped">stopped</option><option value="suspended">suspended</option><option value="unknown">unknown</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="criticality">Criticality</label>
          <select className={selectClass} id="criticality" name="criticality" value={filters.criticality} onChange={(event) => setFilters({ ...filters, criticality: event.target.value })}>
            <option value="">All criticalities</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="lifecycle">Lifecycle</label>
          <select className={selectClass} id="lifecycle" name="lifecycle" value={filters.lifecycle} onChange={(event) => setFilters({ ...filters, lifecycle: event.target.value })}>
            <option value="">All lifecycles</option><option value="planned">planned</option><option value="active">active</option><option value="retiring">retiring</option><option value="retired">retired</option>
          </select>
        </div>
        <div className="lg:col-span-6"><button className={primaryButtonClass} type="submit">Apply filters</button></div>
      </form>
      {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
      {vms.isLoading ? <div className="p-6" role="status">Loading inventory…</div> : null}
      {vms.data && vms.data.items.length > 0 ? <VmTable vms={vms.data.items} /> : null}
      {vms.data && vms.data.items.length === 0 ? <EmptyState title="No VMs found" body="Create a VM or adjust the filters to see inventory." /> : null}
    </section>
  );
}
