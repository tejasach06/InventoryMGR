'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm } from '../api/client';
import { useCurrentUser } from '../components/AuthContext';
import { cn } from '../lib/classNames';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  PageTransition,
  TableSkeleton,
  cardClass,
  monoClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableRowClass,
  tableWrapClass,
} from '../components/ui';
import { useColumnPreferences, COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { formatMemory, formatDisks } from '../lib/units';
import { InventoryToolbar } from '../components/InventoryToolbar';
import { PaginationFooter } from '../components/PaginationFooter';

export const coreFilterNames = ['q', 'platform', 'status', 'criticality'] as const;
export const advancedFilterNames = ['cluster', 'lifecycle', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application', 'ip_role', 'health'] as const;
export const filterNames = [...coreFilterNames, ...advancedFilterNames] as const;

export type FilterName = (typeof filterNames)[number];
export type Filters = Record<FilterName, string[]>;

function emptyFilters(): Filters {
  return {
    q: [],
    platform: [],
    status: [],
    criticality: [],
    cluster: [],
    lifecycle: [],
    environment: [],
    monitoring_enabled: [],
    node: [],
    os_family: [],
    owner: [],
    pmp_enabled: [],
    tag: [],
    application: [],
    ip_role: [],
    health: [],
  };
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_STORAGE_KEY = 'inventory-page-size';

export type ViewState = { page: number; size: number; sort: string | null; dir: 'asc' | 'desc' };

// Keys the API accepts (services/vms.py::SORT_COLUMNS). 'health' maps to
// health_score server-side; keeping one list here stops the two from drifting.
export const SORTABLE_COLUMNS = new Set([
  'name', 'status', 'criticality', 'health', 'updated_at',
  'cluster', 'platform', 'environment', 'lifecycle',
  'cpu_cores', 'memory_mb', 'owner',
]);

function storedPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZES.includes(stored as (typeof PAGE_SIZES)[number]) ? stored : DEFAULT_PAGE_SIZE;
}

export function viewFromParams(params: URLSearchParams): ViewState {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const rawSize = Number(params.get('size'));
  const size = PAGE_SIZES.includes(rawSize as (typeof PAGE_SIZES)[number]) ? rawSize : storedPageSize();
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return { page, size, sort: sort && SORTABLE_COLUMNS.has(sort) ? sort : null, dir };
}

export function paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const values = filters[name];
    if (values.length > 0) {
      values.forEach((v) => params.append(name, v));
    }
  }
  if (view.page > 1) params.set('page', String(view.page));
  if (view.size !== DEFAULT_PAGE_SIZE) params.set('size', String(view.size));
  if (view.sort) {
    params.set('sort', view.sort);
    params.set('dir', view.dir);
  }
  return params;
}

// The wire format the API wants: page/size become limit/offset, page/size drop out.
function queryParamsFor(filters: Filters, view: ViewState): URLSearchParams {
  const params = paramsFromFilters(filters, view);
  params.delete('page');
  params.delete('size');
  params.set('limit', String(view.size));
  params.set('offset', String((view.page - 1) * view.size));
  return params;
}

function filtersFromParams(params: URLSearchParams): Filters {
  const result = emptyFilters();
  for (const name of filterNames) {
    const values = params.getAll(name);
    if (values.length > 0) {
      result[name as FilterName] = values;
    }
  }
  return result;
}

function hasActiveFilters(filters: Filters): boolean {
  return filterNames.some((name) => filters[name].length > 0);
}


/** Enum values are stored snake_case; show them as words. CSS `capitalize`
 * handles the casing, so this only has to deal with the separators. */
function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

const neutralChipClass =
  'inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)] dark:bg-slate-800';

function VmCard({ vm }: { vm: Vm }) {
  return (
    <Link
      href={`/inventory/${vm.id}`}
      className={cn(
        cardClass,
        'block p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] hover:border-[var(--color-accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950'
      )}
    >
      {/* Primary row: name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-[0.9375rem] text-[var(--color-text-primary)] truncate">{vm.name}</h3>
          <p className={cn('mt-0.5 text-xs text-[var(--color-text-tertiary)]', monoClass)}>{vm.platform} · {vm.cluster}</p>
        </div>
        <span className="text-xs capitalize text-[var(--color-text-secondary)]">{humanize(vm.status)}</span>
      </div>

      {/* Metric row: cpu / ram / storage, bento-tile mini-grid */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg bg-[var(--color-surface-secondary)] p-2 dark:bg-slate-800/50">
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)] dark:text-slate-100')}>{vm.cpu_cores}</p>
          <p className="eyebrow-label text-[0.5625rem]">vCPU</p>
        </div>
        <div className="text-center border-x border-[var(--color-border)] dark:border-[var(--color-border)]/60">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)] dark:text-slate-100')}>{formatMemory(vm.memory_mb)}</p>
          <p className="eyebrow-label text-[0.5625rem]">Memory</p>
        </div>
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)] dark:text-slate-100')}>{vm.disks?.length ? formatDisks(vm.disks.map((d) => d.size_gb)) : '—'}</p>
          <p className="eyebrow-label text-[0.5625rem]">Storage</p>
        </div>
      </div>

      {/* Badge cluster */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={neutralChipClass}>{humanize(vm.criticality)}</span>
        {vm.environment && <span className={neutralChipClass}>{humanize(vm.environment)}</span>}
        {vm.lifecycle && <span className={neutralChipClass}>{humanize(vm.lifecycle)}</span>}
        {vm.os_family && <span className={neutralChipClass}>{humanize(vm.os_family)}</span>}
        {vm.owner && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] text-[var(--color-text-secondary)] dark:bg-slate-800">{vm.owner}</span>}
        {vm.tags && vm.tags.length > 0 && (
          <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] text-[var(--color-text-tertiary)] dark:bg-slate-800">
            {vm.tags.slice(0, 2).join(', ')}{vm.tags.length > 2 && ` +${vm.tags.length - 2}`}
          </span>
        )}
      </div>
    </Link>
  );
}


function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  return (
    <svg className={cn('h-3 w-3 transition-opacity', direction ? 'opacity-100 text-[var(--color-accent)]' : 'opacity-30')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      {direction === 'desc' ? (
        <path d="M3 4.5L6 8l3-3.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M3 7.5L6 4l3 3.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function VmTable({
  vms,
  columns,
  selectedIds,
  onToggle,
  onToggleAll,
  sortKey,
  sortDir,
  onSort,
}: {
  vms: Vm[];
  columns: { key: string }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < vms.length;
  }, [selectedIds, vms.length]);


  return (
    <div className={tableWrapClass}>
      <table className={tableClass} role="grid" style={{ '--row-height': 'var(--row-height-comfortable)' } as React.CSSProperties}>
        <thead>
          <tr className={tableHeadClass}>
            <th className="px-4 py-3 w-10">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                checked={selectedIds.size === vms.length && vms.length > 0}
                onChange={() => onToggleAll(vms.map((v) => v.id))}
                aria-label="Select all"
              />
            </th>
            {columns.map((col) => {
              const sortable = SORTABLE_COLUMNS.has(col.key);
              const active = sortKey === col.key;
              const ariaSort = sortable ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
              return (
                <th key={col.key} className="px-4 py-3" aria-sort={ariaSort}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.08em] text-[0.7rem] hover:text-[var(--color-text-primary)] dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded"
                    >
                      {COLUMN_LABELS[col.key as keyof typeof COLUMN_LABELS] || col.key}
                      <SortIcon direction={active ? sortDir : null} />
                    </button>
                  ) : (
                    <span className="font-medium">{COLUMN_LABELS[col.key as keyof typeof COLUMN_LABELS] || col.key}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {vms.map((vm, index) => {
            const isSelected = selectedIds.has(vm.id);

            return (
              <tr
                key={vm.id}
                className={cn(tableRowClass, isSelected && 'bg-[var(--color-accent)]/10')}
              >
                <td className="py-3 pl-3 pr-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    checked={isSelected}
                    onChange={() => onToggle(vm.id)}
                    aria-label={`Select ${vm.name}`}
                  />
                </td>
                {columns.map((col) => (
                  <td key={col.key} data-testid={`cell-${col.key}`} className={cn(tableCellClass, col.key === 'name' && 'font-medium')}>
                    {col.key === 'name' && (
                      <Link href={`/inventory/${vm.id}`} className="hover:text-[var(--color-accent)] transition-colors">
                        {vm.name}
                      </Link>
                    )}
                    {col.key === 'platform' && <Badge value={vm.platform} type="platform" />}
                    {col.key === 'cluster' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.cluster}</span>}
                    {col.key === 'node' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.node}</span>}
                    {col.key === 'status' && <span className="capitalize">{humanize(vm.status)}</span>}
                    {col.key === 'environment' && <span className="capitalize">{humanize(vm.environment)}</span>}
                    {col.key === 'criticality' && <span className="capitalize">{humanize(vm.criticality)}</span>}
                    {col.key === 'lifecycle' && <span className="capitalize">{humanize(vm.lifecycle)}</span>}
                    {col.key === 'os_family' && <span className="capitalize">{humanize(vm.os_family ?? 'unknown')}</span>}
                    {col.key === 'owner' && <span className="truncate max-w-xs">{vm.owner ?? ''}</span>}
                    {col.key === 'monitoring_enabled' && <span>{vm.monitoring_enabled ? 'Enabled' : 'Disabled'}</span>}
                    {col.key === 'pmp_enabled' && <span>{vm.pmp_enabled ? 'Enabled' : 'Disabled'}</span>}
                    {col.key === 'health' && <span className={monoClass}>{vm.health_score}</span>}
                    {col.key === 'resources' && (
                      <span className={cn(monoClass, "truncate max-w-[200px]")}>{vm.cpu_cores} vCPU · {formatMemory(vm.memory_mb)}</span>
                    )}
                    {col.key === 'fqdn' && <span className={cn(monoClass, "truncate max-w-xs")}>{vm.fqdn ?? ''}</span>}
                    {col.key === 'private_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'private')?.ip_address ?? '—'}</span>}
                    {col.key === 'public_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'public')?.ip_address ?? '—'}</span>}
                    {col.key === 'backup_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'backup')?.ip_address ?? '—'}</span>}
                    {col.key === 'tags' && vm.tags?.length && (
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        {vm.tags.slice(0, 3).map((t) => (
                          <span key={t} className="inline-flex items-center rounded bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 text-xs text-[var(--color-text-tertiary)]">{t}</span>
                        ))}
                        {vm.tags.length > 3 && <span className="text-xs text-[var(--color-text-tertiary)]">+{vm.tags.length - 3}</span>}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
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
  const [view, setView] = useState<ViewState>(() => viewFromParams(searchParams));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { columns: colPrefs, visibleColumns, toggleColumn, reorderColumns, resetToDefault } = useColumnPreferences('inventory-list');

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
    setView(viewFromParams(searchParams));
  }, [searchParams]);

  function pushView(next: ViewState) {
    setView(next);
    const params = paramsFromFilters(filtersFromParams(searchParams), next);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  function handleSort(key: string) {
    // asc -> desc -> unsorted, the existing three-state cycle.
    if (view.sort !== key) pushView({ ...view, sort: key, dir: 'asc', page: 1 });
    else if (view.dir === 'asc') pushView({ ...view, dir: 'desc', page: 1 });
    else pushView({ ...view, sort: null, dir: 'asc', page: 1 });
  }

  function handleSizeChange(size: number) {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
    // ponytail: localStorage, not the user-preferences JSONB — upgrade to
    // /api/preferences if page size must follow the account across devices.
    pushView({ ...view, size, page: 1 });
    setSelectedIds(new Set());
  }

  function handlePageChange(page: number) {
    pushView({ ...view, page });
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  const queryParams = useMemo(
    () => queryParamsFor(filtersFromParams(searchParams), viewFromParams(searchParams)),
    [searchParams],
  );
  const exportFilteredUrl = api.exportVmsUrl(queryParams);
  function exportSelected() {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds]);
  }
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = paramsFromFilters(filters, { ...viewFromParams(searchParams), page: 1 });
      const current = paramsFromFilters(filtersFromParams(searchParams), viewFromParams(searchParams));
      if (params.toString() !== current.toString()) {
        router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, pathname, router, searchParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(filters, { ...view, page: 1 });
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    setFilters(emptyFilters());
    const params = paramsFromFilters(emptyFilters(), { ...view, page: 1 });
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const items = vms.data?.items ?? [];
  const total = vms.data?.total ?? items.length;

  // A stale deep link can point past the end of a shrunken result set.
  useEffect(() => {
    if (!vms.data) return;
    const lastPage = Math.max(1, Math.ceil(total / view.size));
    if (view.page > lastPage) pushView({ ...view, page: lastPage });
  }, [vms.data, total, view.size, view.page]);

  return (
    <PageTransition>
      <section>
        <PageHeader
          title="Inventory"
          eyebrow="Infrastructure"
          actions={
            <div className="flex items-center gap-2">
              <a href={exportFilteredUrl} download="vm-inventory.csv" className={secondaryButtonClass}>
                Export filtered
              </a>
              {canCreateVm && <Link className={primaryButtonClass} href="/inventory/new">New VM</Link>}
            </div>
          }
        />

        <InventoryToolbar
          filters={filters}
          onApply={setFilters}
          columns={colPrefs}
          onToggleColumn={toggleColumn}
          onReorderColumns={reorderColumns}
          onResetColumns={resetToDefault}
        />
        {!vms.data ? (
          <div className="mb-4 flex items-center justify-between">
            <p className="eyebrow-label">Loading…</p>
          </div>
        ) : null}

        {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
        {vms.isLoading ? <TableSkeleton rows={8} cols={7} /> : null}
        {vms.data && vms.data.items.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <VmTable
                vms={vms.data.items}
                columns={visibleColumns}
                selectedIds={selectedIds}
                onToggle={toggleSelect}
                onToggleAll={toggleSelectAll}
                sortKey={view.sort}
                sortDir={view.dir}
                onSort={handleSort}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {vms.data.items.map((vm) => (
                <VmCard key={vm.id} vm={vm} />
              ))}
            </div>
          </>
        ) : null}
        {vms.data ? (
          <PaginationFooter
            total={total}
            page={view.page}
            size={view.size}
            onPageChange={handlePageChange}
            onSizeChange={handleSizeChange}
          />
        ) : null}
        {vms.data && vms.data.items.length === 0 ? (
          hasActiveFilters(filters) ? (
            <EmptyState
              title="No VMs match these filters"
              body="Try loosening a filter or clearing them entirely — nothing in the fleet matches the current combination."
              actions={
                <button type="button" className={primaryButtonClass} onClick={clearFilters}>
                  Clear all filters
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No VMs yet"
              body="Bring your fleet into view by creating a VM manually or importing an existing inventory export."
              actions={
                canCreateVm ? (
                  <>
                    <Link className={primaryButtonClass} href="/inventory/new">Create first VM</Link>
                    <Link className={secondaryButtonClass} href="/imports/new">Import CSV</Link>
                  </>
                ) : undefined
              }
            />
          )
        ) : null}
      </section>

      {/* Bulk action bar — the only surface for bulk actions now that the
          context panel is gone. */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-40 bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-text-primary)] px-4 py-2.5 text-white shadow-[var(--shadow-overlay)] dark:bg-slate-800 dark:border-slate-700">
            <span className="text-sm font-semibold tabular-nums">{selectedIds.size} selected</span>
            <div className="h-4 w-px bg-white/20" aria-hidden="true" />
            <button type="button" onClick={exportSelected} className="text-sm font-medium text-white/90 hover:text-white transition-colors">
              Export
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm font-medium text-white/60 hover:text-white transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
