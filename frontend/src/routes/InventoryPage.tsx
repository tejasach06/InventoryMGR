'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { Alert, Badge, EmptyState, PageHeader, PageTransition, TableSkeleton, cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';
import { ColumnEditor } from '../components/ColumnEditor';
import { useColumnPreferences, COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { formatMemory } from '../lib/units';

const coreFilterNames = ['q', 'platform', 'status', 'criticality'] as const;
const advancedFilterNames = ['environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application', 'health'] as const;
const filterNames = [...coreFilterNames, ...advancedFilterNames] as const;
const operableFilterNames = ['platform', 'status', 'criticality', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application'] as const;

type FilterName = (typeof filterNames)[number];
type AdvancedFilterName = (typeof advancedFilterNames)[number];
type OperableFilterName = (typeof operableFilterNames)[number];
type Filters = Record<FilterName, string>;
type Operators = Record<OperableFilterName, string>;

const defaultOperators: Operators = {
  platform: 'eq', status: 'eq', criticality: 'eq', environment: 'eq', monitoring_enabled: 'eq',
  node: 'eq', os_family: 'eq', owner: 'eq', pmp_enabled: 'eq', tag: 'eq', application: 'contains',
};

const advancedFilterLabels: Record<AdvancedFilterName, string> = {
  environment: 'Environment', monitoring_enabled: 'Monitoring', node: 'Node',
  os_family: 'OS Family', owner: 'Owner', pmp_enabled: 'PMP Access',
  tag: 'Tag', application: 'Application', health: 'Doc Health',
};

type AdvancedFieldConfig =
  | { kind: 'select'; options: readonly { value: string; label: string }[] }
  | { kind: 'dynamicSelect' }
  | { kind: 'input'; placeholder: string };

const advancedFilterConfig: Record<AdvancedFilterName, AdvancedFieldConfig> = {
  environment: { kind: 'select', options: [
    { value: '', label: 'All environments' }, { value: 'production', label: 'production' },
    { value: 'development', label: 'development' }, { value: 'testing', label: 'testing' },
    { value: 'uat', label: 'uat' }, { value: 'dr', label: 'dr' },
    { value: 'staging', label: 'staging' }, { value: 'sandbox', label: 'sandbox' },
  ] },
  monitoring_enabled: { kind: 'select', options: [
    { value: '', label: 'All' }, { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' },
  ] },
  os_family: { kind: 'select', options: [
    { value: '', label: 'All' }, { value: 'linux', label: 'Linux' }, { value: 'windows', label: 'Windows' },
  ] },
  owner: { kind: 'dynamicSelect' },
  pmp_enabled: { kind: 'select', options: [
    { value: '', label: 'All' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' },
  ] },
  health: { kind: 'select', options: [
    { value: '', label: 'All' }, { value: 'below_50', label: '< 50%' },
    { value: 'below_75', label: '< 75%' }, { value: 'complete', label: 'Complete (100%)' },
  ] },
  node: { kind: 'input', placeholder: 'Node name' },
  tag: { kind: 'input', placeholder: 'Exact tag' },
  application: { kind: 'input', placeholder: 'App name' },
};

const operatorOptions = [
  { value: 'eq', label: 'Is' },
  { value: 'contains', label: 'Contains' },
  { value: 'neq', label: 'Is not' },
] as const;

function emptyFilters(): Filters {
  return {
    q: '', platform: '', status: '', criticality: '', environment: '', monitoring_enabled: '',
    node: '', os_family: '', owner: '', pmp_enabled: '', tag: '', application: '', health: '',
  };
}

function paramsFromFilters(filters: Filters, operators: Operators): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const value = filters[name].trim();
    if (value.length > 0) params.set(name, value);
  }
  for (const name of operableFilterNames) {
    if (filters[name].trim().length > 0 && operators[name] !== defaultOperators[name]) {
      params.set(`${name}_op`, operators[name]);
    }
  }
  params.set('limit', '50');
  params.set('offset', '0');
  return params;
}

function filtersFromParams(params: URLSearchParams): Filters {
  const result = emptyFilters();
  for (const name of filterNames) result[name] = params.get(name) ?? '';
  return result;
}

function operatorsFromParams(params: URLSearchParams): Operators {
  const result = { ...defaultOperators };
  for (const name of operableFilterNames) result[name] = params.get(`${name}_op`) ?? defaultOperators[name];
  return result;
}

function revealedFromParams(params: URLSearchParams): Set<AdvancedFilterName> {
  const revealed = new Set<AdvancedFilterName>();
  for (const name of advancedFilterNames) {
    if ((params.get(name) ?? '').trim().length > 0) revealed.add(name);
  }
  return revealed;
}

function hasActiveFilters(filters: Filters): boolean {
  return filterNames.some((name) => filters[name].trim().length > 0);
}

function OperatorSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <select className={`${selectClass} mt-1.5`} aria-label={`${label} operator`} value={value} onChange={(event) => onChange(event.target.value)}>
      {operatorOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
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
  const [operators, setOperators] = useState<Operators>(() => operatorsFromParams(searchParams));
  const [revealed, setRevealed] = useState<Set<AdvancedFilterName>>(() => revealedFromParams(searchParams));
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { columns: colPrefs, visibleColumns, toggleColumn, moveColumn, resetToDefault } = useColumnPreferences('inventory-list');

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

  const exportFilteredUrl = api.exportVmsUrl(paramsFromFilters(filtersFromParams(searchParams), operatorsFromParams(searchParams)));
  function exportSelected() {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds]);
  }
  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams), operatorsFromParams(searchParams)), [searchParams]);
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });
  const owners = useQuery({ queryKey: ['vm-owners'], queryFn: () => api.listVmOwners(), staleTime: 60_000 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
    setOperators(operatorsFromParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = paramsFromFilters(filters, operators);
      const current = paramsFromFilters(filtersFromParams(searchParams), operatorsFromParams(searchParams));
      if (params.toString() !== current.toString()) {
        router.push(`${pathname}?${params.toString()}`);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, operators, pathname, router, searchParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(filters, operators);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    setFilters(emptyFilters());
    setOperators({ ...defaultOperators });
    setRevealed(new Set());
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
            <OperatorSelect label="Platform" value={operators.platform} onChange={(value) => setOperators({ ...operators, platform: value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="status">Status</label>
            <select className={selectClass} id="status" name="status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All statuses</option><option value="running">running</option><option value="powered_off">powered_off</option><option value="suspended">suspended</option><option value="archived">archived</option><option value="decommissioned">decommissioned</option><option value="unknown">unknown</option>
            </select>
            <OperatorSelect label="Status" value={operators.status} onChange={(value) => setOperators({ ...operators, status: value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="criticality">Criticality</label>
            <select className={selectClass} id="criticality" name="criticality" value={filters.criticality} onChange={(event) => setFilters({ ...filters, criticality: event.target.value })}>
              <option value="">All criticalities</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
            </select>
            <OperatorSelect label="Criticality" value={operators.criticality} onChange={(value) => setOperators({ ...operators, criticality: value })} />
          </div>
          {advancedFilterNames.filter((name) => revealed.has(name)).map((name) => {
            const config = advancedFilterConfig[name];
            const label = advancedFilterLabels[name];
            return (
              <div key={name}>
                <label className={labelClass} htmlFor={name}>{label}</label>
                {config.kind === 'input' ? (
                  <input className={inputClass} id={name} name={name} value={filters[name]} placeholder={config.placeholder}
                    onChange={(event) => setFilters({ ...filters, [name]: event.target.value })} />
                ) : (
                  <select className={selectClass} id={name} name={name} value={filters[name]}
                    onChange={(event) => setFilters({ ...filters, [name]: event.target.value })}>
                    {config.kind === 'select'
                      ? config.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)
                      : <>
                          <option value="">All owners</option>
                          {(owners.data ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </>}
                  </select>
                )}
                {name !== 'health' && (
                  <OperatorSelect label={label} value={operators[name as OperableFilterName]}
                    onChange={(value) => setOperators({ ...operators, [name as OperableFilterName]: value })} />
                )}
              </div>
            );
          })}
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
            <div className="relative">
              <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" onClick={() => setAddFilterOpen((open) => !open)}>
                + Add filter
              </button>
              {addFilterOpen && (
                <ul className="absolute z-10 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {advancedFilterNames.filter((name) => !revealed.has(name)).map((name) => (
                    <li key={name}>
                      <button type="button" onClick={() => { setRevealed((prev) => new Set(prev).add(name)); setAddFilterOpen(false); }}
                        className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                        {advancedFilterLabels[name]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ColumnEditor columns={colPrefs} onToggle={toggleColumn} onMove={moveColumn} onReset={resetToDefault} />
            {hasActiveFilters(filters) ? (
              <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" onClick={clearFilters}>Clear filters</button>
            ) : null}
          </div>
        </form>
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
