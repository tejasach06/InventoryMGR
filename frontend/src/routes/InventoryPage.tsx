'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { Alert, Badge, EmptyState, PageHeader, PageTransition, TableSkeleton, cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';
import { formatMemory } from '../lib/units';

const filterNames = ['q', 'platform', 'status', 'criticality', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'department', 'tag', 'application', 'health'] as const;

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
    status: params.get('status') ?? '',
    criticality: params.get('criticality') ?? '',
    environment: params.get('environment') ?? '',
    monitoring_enabled: params.get('monitoring_enabled') ?? '',
    node: params.get('node') ?? '',
    os_family: params.get('os_family') ?? '',
    owner: params.get('owner') ?? '',
    department: params.get('department') ?? '',
    tag: params.get('tag') ?? '',
    application: params.get('application') ?? '',
    health: params.get('health') ?? '',
  };
}

function hasActiveFilters(filters: Filters): boolean {
  return filterNames.some((name) => filters[name].trim().length > 0);
}

function VmCard({ vm }: { vm: Vm }) {
  return (
    <Link href={`/inventory/${vm.id}`} className={cardClass + ' block transition-colors duration-150 hover:border-slate-300 dark:hover:border-slate-600'}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-slate-950 dark:text-slate-100">{vm.name}</span>
        <Badge value={vm.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
        <span>{vm.platform}</span>
        <span>{vm.cluster}</span>
        <Badge value={vm.criticality} />
      </div>
      <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        {vm.cpu_cores} CPU / {formatMemory(vm.memory_mb)} / {`${vm.disks.length} disk(s)`}
      </div>
      <div className="mt-1 text-xs">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          vm.health_score >= 100 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
          vm.health_score >= 75 ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
          vm.health_score >= 50 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
          'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
        }`}>Health {vm.health_score}%</span>
      </div>
    </Link>
  );
}

function VmTable({ vms, selectedIds, onToggle, onToggleAll }: { vms: Vm[], selectedIds: Set<string>, onToggle: (id: string) => void, onToggleAll: (ids: string[]) => void }) {
  const router = useRouter();
  const allSelected = vms.length > 0 && vms.every(vm => selectedIds.has(vm.id));
  return (
    <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead className={tableHeadClass}>
          <tr>
            <th className="px-3 py-3" scope="col"><input type="checkbox" checked={allSelected} onChange={() => onToggleAll(vms.map(v => v.id))} /></th>
            <th className="px-4 py-3" scope="col">Name</th>
            <th className="px-4 py-3" scope="col">Platform</th>
            <th className="px-4 py-3" scope="col">Cluster</th>
            <th className="px-4 py-3" scope="col">Status</th>
            <th className="px-4 py-3" scope="col">Resources</th>
            <th className="px-4 py-3" scope="col">Criticality</th>
            <th className="px-4 py-3" scope="col">Health</th>
            <th className="px-4 py-3" scope="col">Updated</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {vms.map((vm) => (
            <tr key={vm.id} className={tableRowClass + ' cursor-pointer'} onClick={() => router.push(`/inventory/${vm.id}`)}>
              <td className="px-3 py-3" onClick={e => { e.stopPropagation(); onToggle(vm.id); }}>
                <input type="checkbox" checked={selectedIds.has(vm.id)} onChange={() => onToggle(vm.id)} />
              </td>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-blue-700 dark:text-blue-300" scope="row"><Link className="hover:text-blue-900 hover:underline dark:hover:text-blue-200" href={`/inventory/${vm.id}`}>{vm.name}</Link></th>
              <td className={tableCellClass}>{vm.platform}</td>
              <td className={tableCellClass}>{vm.cluster}</td>
              <td className="whitespace-nowrap px-4 py-3"><Badge value={vm.status} /></td>
              <td className={tableCellClass}>{vm.cpu_cores} CPU / {formatMemory(vm.memory_mb)} / {`${vm.disks.length} disk(s)`}</td>
              <td className="whitespace-nowrap px-4 py-3"><Badge value={vm.criticality} /></td>
              <td className="whitespace-nowrap px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  vm.health_score >= 100 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
                  vm.health_score >= 75 ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
                  vm.health_score >= 50 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                }`}>{vm.health_score}%</span>
              </td>
              <td className={tableCellClass}>{new Date(vm.updated_at).toLocaleString()}</td>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids));
  }

  const exportFilteredUrl = api.exportVmsUrl(paramsFromFilters(filtersFromParams(searchParams)));
  function exportSelected() {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds]);
  }
  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams)), [searchParams]);
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });
  const owners = useQuery({ queryKey: ['vm-owners'], queryFn: () => api.listVmOwners(), staleTime: 60_000 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = paramsFromFilters(filters);
      const current = paramsFromFilters(filtersFromParams(searchParams));
      if (params.toString() !== current.toString()) {
        router.push(`${pathname}?${params.toString()}`);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, pathname, router, searchParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(filters);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    const empty: Filters = { q: '', platform: '', status: '', criticality: '', environment: '', monitoring_enabled: '', node: '', os_family: '', owner: '', department: '', tag: '', application: '', health: '' };
    setFilters(empty);
    router.push(pathname);
  }

  return (
    <PageTransition>
      <section>
        <PageHeader title="Inventory" actions={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button type="button" className={secondaryButtonClass} onClick={exportSelected}>
                Export selected ({selectedIds.size})
              </button>
            )}
            <a href={exportFilteredUrl} download="vm-inventory.csv" className={secondaryButtonClass}>
              Export filtered
            </a>
            {canCreateVm && <Link className={primaryButtonClass} href="/inventory/new">New VM</Link>}
          </div>
        } />
        <form className={cardClass + ' mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5'} onSubmit={submit}>
          <div className="sm:col-span-2 lg:col-span-2">
            <label className={labelClass} htmlFor="q">Search</label>
            <input className={inputClass} id="q" name="q" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Name, owner, cluster" />
          </div>
          <div>
            <label className={labelClass} htmlFor="platform">Platform</label>
            <select className={selectClass} id="platform" name="platform" value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
              <option value="">All platforms</option><option value="proxmox">proxmox</option><option value="vmware">vmware</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="status">Status</label>
            <select className={selectClass} id="status" name="status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All statuses</option><option value="running">running</option><option value="powered_off">powered_off</option><option value="suspended">suspended</option><option value="archived">archived</option><option value="decommissioned">decommissioned</option><option value="unknown">unknown</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="criticality">Criticality</label>
            <select className={selectClass} id="criticality" name="criticality" value={filters.criticality} onChange={(event) => setFilters({ ...filters, criticality: event.target.value })}>
              <option value="">All criticalities</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="environment">Environment</label>
            <select className={selectClass} id="environment" name="environment" value={filters.environment} onChange={(event) => setFilters({ ...filters, environment: event.target.value })}>
              <option value="">All environments</option><option value="production">production</option><option value="development">development</option><option value="testing">testing</option><option value="uat">uat</option><option value="dr">dr</option><option value="staging">staging</option><option value="sandbox">sandbox</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="monitoring_enabled">Monitoring</label>
            <select className={selectClass} id="monitoring_enabled" name="monitoring_enabled" value={filters.monitoring_enabled} onChange={(event) => setFilters({ ...filters, monitoring_enabled: event.target.value })}>
              <option value="">All</option><option value="true">Enabled</option><option value="false">Disabled</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="os_family">OS Family</label>
            <select className={selectClass} id="os_family" name="os_family" value={filters.os_family} onChange={(event) => setFilters({ ...filters, os_family: event.target.value })}>
              <option value="">All</option><option value="linux">Linux</option><option value="windows">Windows</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="owner">Owner</label>
            <select className={selectClass} id="owner" name="owner" value={filters.owner} onChange={(event) => setFilters({ ...filters, owner: event.target.value })}>
              <option value="">All owners</option>
              {(owners.data ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="health">Doc Health</label>
            <select className={selectClass} id="health" name="health" value={filters.health} onChange={(event) => setFilters({ ...filters, health: event.target.value })}>
              <option value="">All</option><option value="below_50">&lt; 50%</option><option value="below_75">&lt; 75%</option><option value="complete">Complete (100%)</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="node">Node</label>
            <input className={inputClass} id="node" name="node" value={filters.node} onChange={(event) => setFilters({ ...filters, node: event.target.value })} placeholder="Node name" />
          </div>
          <div>
            <label className={labelClass} htmlFor="department">Department</label>
            <input className={inputClass} id="department" name="department" value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })} placeholder="Department" />
          </div>
          <div>
            <label className={labelClass} htmlFor="tag">Tag</label>
            <input className={inputClass} id="tag" name="tag" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} placeholder="Exact tag" />
          </div>
          <div>
            <label className={labelClass} htmlFor="application">Application</label>
            <input className={inputClass} id="application" name="application" value={filters.application} onChange={(event) => setFilters({ ...filters, application: event.target.value })} placeholder="App name" />
          </div>
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
            {hasActiveFilters(filters) ? <button type="button" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" onClick={clearFilters}>Clear filters</button> : null}
          </div>
        </form>
        {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
        {vms.isLoading ? <TableSkeleton rows={8} cols={7} /> : null}
        {vms.data && vms.data.items.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{vms.data.items.length} VM{vms.data.items.length !== 1 ? 's' : ''}</p>
            <div className="hidden lg:block"><VmTable vms={vms.data.items} selectedIds={selectedIds} onToggle={toggleSelect} onToggleAll={toggleSelectAll} /></div>
            <div className="grid gap-3 lg:hidden">{vms.data.items.map((vm) => <VmCard key={vm.id} vm={vm} />)}</div>
          </>
        ) : null}
        {vms.data && vms.data.items.length === 0 ? <EmptyState title="No VMs found" body="Create a VM or adjust the filters to see inventory." /> : null}
      </section>
    </PageTransition>
  );
}
