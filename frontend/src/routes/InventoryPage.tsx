'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { Alert, Badge, EmptyState, PageHeader, PageTransition, TableSkeleton, cardClass, inputClass, primaryButtonClass, secondaryButtonClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';
import { ColumnEditor } from '../components/ColumnEditor';
import { useColumnPreferences, COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { formatMemory } from '../lib/units';
import { useFilterPresets } from '../hooks/useFilterPresets';
import { AdvancedFilters, FilterDrawer } from '../components/FilterDrawer';

const coreFilterNames = ['q', 'platform', 'status', 'criticality'] as const;
const advancedFilterNames = ['cluster', 'lifecycle', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application', 'health'] as const;
const filterNames = [...coreFilterNames, ...advancedFilterNames] as const;

type FilterName = (typeof filterNames)[number];
type Filters = Record<FilterName, string[]>;

function emptyFilters(): Filters {
  return {
    q: [], platform: [], status: [], criticality: [], cluster: [], lifecycle: [],
    environment: [], monitoring_enabled: [],
    node: [], os_family: [], owner: [], pmp_enabled: [], tag: [], application: [], health: [],
  };
}

function paramsFromFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    if (name === 'q' || name === 'health') {
      const val = filters[name][0]?.trim() || '';
      if (val) params.set(name, val);
    } else {
      for (const val of filters[name]) {
        if (val.trim()) params.append(name, val.trim());
      }
    }
  }
  params.set('limit', '50');
  params.set('offset', '0');
  return params;
}

function filtersFromParams(params: URLSearchParams): Filters {
  const result = emptyFilters();
  for (const name of filterNames) {
    if (name === 'q' || name === 'health') {
      const val = params.get(name) ?? '';
      result[name] = val ? [val] : [];
    } else {
      const vals = params.getAll(name).filter(Boolean);
      result[name] = vals.length > 0 ? vals : [];
    }
  }
  return result;
}

function hasActiveFilters(filters: Filters): boolean {
  return filterNames.some((name) => filters[name].length > 0);
}

function ActiveFilterPills({ filters, onRemove }: { filters: Filters; onRemove: (name: FilterName, value: string) => void }) {
  const pills: { name: FilterName; value: string }[] = [];
  for (const name of filterNames) {
    for (const val of filters[name]) pills.push({ name, value: val });
  }
  if (pills.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {pills.map((pill, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <span className="capitalize">{pill.name.replace(/_/g, ' ')}:</span>
          <span className="font-semibold">{pill.value}</span>
          <button type="button" onClick={() => onRemove(pill.name, pill.value)} className="ml-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">&times;</button>
        </span>
      ))}
    </div>
  );
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
      <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
        {vm.networks[0]?.ip_address ?? '—'}
      </div>
    </Link>
  );
}

function VmTable({ vms, columns, selectedIds, onToggle, onToggleAll }: { vms: Vm[]; columns: { key: string }[]; selectedIds: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[]) => void }) {
  const router = useRouter();
  const allSelected = vms.length > 0 && vms.every(vm => selectedIds.has(vm.id));
  return (
    <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead className={tableHeadClass}>
          <tr>
            <th className="px-3 py-3" scope="col"><input type="checkbox" checked={allSelected} onChange={() => onToggleAll(vms.map(v => v.id))} /></th>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3" scope="col">{COLUMN_LABELS[col.key] ?? col.key}</th>
            ))}
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {vms.map((vm) => (
            <tr key={vm.id} className={tableRowClass + ' cursor-pointer'} onClick={() => router.push(`/inventory/${vm.id}`)}>
              <td className="px-3 py-3" onClick={e => { e.stopPropagation(); onToggle(vm.id); }}>
                <input type="checkbox" checked={selectedIds.has(vm.id)} onChange={() => onToggle(vm.id)} />
              </td>
              {columns.map((col) => {
                switch (col.key) {
                  case 'name':
                    return <th key={col.key} className="whitespace-nowrap px-4 py-3 text-left font-semibold text-blue-700 dark:text-blue-300" scope="row"><Link className="hover:text-blue-900 hover:underline dark:hover:text-blue-200" href={`/inventory/${vm.id}`}>{vm.name}</Link></th>;
                  case 'platform': return <td key={col.key} className={tableCellClass}>{vm.platform}</td>;
                  case 'cluster': return <td key={col.key} className={`${tableCellClass} tech`}>{vm.cluster}</td>;
                  case 'status': return <td key={col.key} className="whitespace-nowrap px-4 py-3"><Badge value={vm.status} /></td>;
                  case 'resources': return <td key={col.key} className={`${tableCellClass} tech text-[0.8125rem]`}>{vm.cpu_cores} CPU · {formatMemory(vm.memory_mb)} · {vm.disks.length} disk{vm.disks.length !== 1 ? 's' : ''}</td>;
                  case 'criticality': return <td key={col.key} className="whitespace-nowrap px-4 py-3"><Badge value={vm.criticality} /></td>;
                  case 'ip_address': return <td key={col.key} className="whitespace-nowrap px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{vm.networks[0]?.ip_address ?? '—'}</td>;
                  case 'updated_at': return <td key={col.key} className={`${tableCellClass} tech text-[0.8125rem] text-slate-500 dark:text-slate-400`}>{new Date(vm.updated_at).toLocaleDateString('en-CA')}</td>;
                  case 'fqdn': return <td key={col.key} className={`${tableCellClass} font-mono text-slate-600 dark:text-slate-300`}>{vm.fqdn ?? '—'}</td>;
                  case 'environment': return <td key={col.key} className="whitespace-nowrap px-4 py-3"><Badge value={vm.environment} /></td>;
                  case 'lifecycle': return <td key={col.key} className="whitespace-nowrap px-4 py-3"><Badge value={vm.lifecycle} /></td>;
                  case 'vm_type': return <td key={col.key} className={tableCellClass}>{vm.vm_type}</td>;
                  case 'datacenter': return <td key={col.key} className={tableCellClass}>{vm.datacenter ?? '—'}</td>;
                  case 'node': return <td key={col.key} className={`${tableCellClass} tech`}>{vm.node ?? '—'}</td>;
                  case 'os': return <td key={col.key} className={tableCellClass}>{vm.os_name ? `${vm.os_name}${vm.os_version ? ` ${vm.os_version}` : ''}` : '—'}</td>;
                  case 'owner': return <td key={col.key} className={tableCellClass}>{vm.owner ?? '—'}</td>;
                  case 'business_owner': return <td key={col.key} className={tableCellClass}>{vm.business_owner ?? '—'}</td>;
                  case 'technical_owner': return <td key={col.key} className={tableCellClass}>{vm.technical_owner ?? '—'}</td>;
                  case 'pmp_enabled': return <td key={col.key} className={tableCellClass} aria-label={vm.pmp_enabled ? 'PMP enabled' : 'PMP disabled'}>{vm.pmp_enabled ? '✓' : '—'}</td>;
                  case 'monitoring_enabled': return <td key={col.key} className={tableCellClass} aria-label={vm.monitoring_enabled ? 'Monitoring enabled' : 'Monitoring disabled'}>{vm.monitoring_enabled ? '✓' : '—'}</td>;
                  case 'backup_enabled': return <td key={col.key} className={tableCellClass} aria-label={vm.backup_enabled ? 'Backup enabled' : 'Backup disabled'}>{vm.backup_enabled ? '✓' : '—'}</td>;
                  case 'ha_enabled': return <td key={col.key} className={tableCellClass} aria-label={vm.ha_enabled ? 'HA enabled' : 'HA disabled'}>{vm.ha_enabled ? '✓' : '—'}</td>;
                  case 'health_score': return <td key={col.key} className={`${tableCellClass} tech`}>{vm.health_score}</td>;
                  case 'tags': return <td key={col.key} className={`${tableCellClass} max-w-[16rem] truncate`} title={vm.tags.join(', ')}>{vm.tags.length ? vm.tags.join(', ') : '—'}</td>;
                  case 'created_at': return <td key={col.key} className={`${tableCellClass} tech text-[0.8125rem] text-slate-500 dark:text-slate-400`}>{new Date(vm.created_at).toLocaleDateString('en-CA')}</td>;
                  default: return null;
                }
              })}
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { columns: colPrefs, visibleColumns, toggleColumn, reorderColumns, resetToDefault } = useColumnPreferences('inventory-list');
  const { presets, savePreset, deletePreset } = useFilterPresets<Filters, Record<string, string>>('inventory_presets');
  const [saveName, setSaveName] = useState('');

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

  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams)), [searchParams]);
  const exportFilteredUrl = api.exportVmsUrl(queryParams);
  function exportSelected() {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds]);
  }
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });
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
    setFilters(emptyFilters());
    router.push(pathname);
  }

  function removePill(name: FilterName, value: string) {
    setFilters((prev) => ({ ...prev, [name]: prev[name].filter((v) => v !== value) }));
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
        <div className={cardClass + ' mb-6'}>
          <form className="flex flex-wrap items-center gap-4" onSubmit={submit}>
            <div className="flex-1 min-w-[200px]">
              <input className={inputClass} id="q" name="q" value={filters.q[0] || ''} onChange={(event) => setFilters({ ...filters, q: event.target.value ? [event.target.value] : [] })} placeholder="Search name, owner, cluster..." />
            </div>

            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setAdvancedOpen(true)} className={`${secondaryButtonClass} bg-slate-50 dark:bg-slate-800`}>
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                Filters
              </button>

              <ColumnEditor columns={colPrefs} onToggle={toggleColumn} onReorder={reorderColumns} onReset={resetToDefault} />

              {hasActiveFilters(filters) ? (
                <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" onClick={clearFilters}>Clear</button>
              ) : null}
            </div>
          </form>

          <ActiveFilterPills filters={filters} onRemove={removePill} />

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <select className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                onChange={(e) => {
                  if (e.target.value && presets[e.target.value]) {
                    setFilters(presets[e.target.value].filters);
                  }
                  e.target.value = ''; // reset select
                }}
                defaultValue=""
              >
                <option value="" disabled>Load preset...</option>
                {Object.keys(presets).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (saveName.trim()) { savePreset(saveName.trim(), filters, {}); setSaveName(''); } }}>
                <input className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" placeholder="Preset name" value={saveName} onChange={e => setSaveName(e.target.value)} />
                <button type="submit" disabled={!saveName.trim()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">Save</button>
              </form>
            </div>
          </div>
        </div>

        <FilterDrawer open={advancedOpen} onClose={() => setAdvancedOpen(false)} filters={filters as unknown as AdvancedFilters} onApply={(f) => setFilters(prev => ({ ...prev, ...f }))} />

        {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
        {vms.isLoading ? <TableSkeleton rows={8} cols={7} /> : null}
        {vms.data && vms.data.items.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{vms.data.items.length} VM{vms.data.items.length !== 1 ? 's' : ''}</p>
            <div className="hidden lg:block"><VmTable vms={vms.data.items} columns={visibleColumns} selectedIds={selectedIds} onToggle={toggleSelect} onToggleAll={toggleSelectAll} /></div>
            <div className="grid gap-3 lg:hidden">{vms.data.items.map((vm) => <VmCard key={vm.id} vm={vm} />)}</div>
          </>
        ) : null}
        {vms.data && vms.data.items.length === 0 ? <EmptyState title="No VMs found" body="Create a VM or adjust the filters to see inventory." /> : null}
      </section>
    </PageTransition>
  );
}
