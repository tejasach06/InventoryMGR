'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, detailMessage, Vm, BulkResult } from '../api/client';
import { BulkEditDrawer, BulkPatch } from '../components/BulkEditDrawer';
import { useCurrentUser } from '../components/AuthContext';
import { cn } from '../lib/classNames';
import {
  Alert,
  Badge,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  PageTransition,
  TableSkeleton,
  cardClass,
  inputClass,
  monoClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
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
export const advancedFilterNames = ['cluster', 'lifecycle', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application', 'ip_role', 'health', 'shutdown_stale', 'decommission_overdue', 'missing_ip'] as const;
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
    shutdown_stale: [],
    decommission_overdue: [],
    missing_ip: [],
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
  'inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)]';

function VmCard({ vm }: { vm: Vm }) {
  return (
    <Link
      href={`/inventory/${vm.id}`}
      className={cn(
        cardClass,
        'block p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] hover:border-[var(--color-accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]'
      )}
    >
      {/* Primary row: name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn(monoClass, "truncate font-semibold text-[var(--color-text-primary)]")}>{vm.name}</h3>
          <p className={cn('mt-0.5 text-xs text-[var(--color-text-tertiary)]', monoClass)}>{vm.platform} · {vm.cluster}</p>
        </div>
        <Badge value={vm.status} type="status" size="sm" />
      </div>

      {/* Metric row: cpu / ram / storage, bento-tile mini-grid */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg bg-[var(--color-surface-secondary)] p-2">
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{vm.cpu_cores}</p>
          <p className="eyebrow-label text-[0.5625rem]">vCPU</p>
        </div>
        <div className="text-center border-x border-[var(--color-border)]">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{formatMemory(vm.memory_mb)}</p>
          <p className="eyebrow-label text-[0.5625rem]">Memory</p>
        </div>
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{vm.disks?.length ? formatDisks(vm.disks.map((d) => d.size_gb)) : '—'}</p>
          <p className="eyebrow-label text-[0.5625rem]">Storage</p>
        </div>
      </div>

      {/* Badge cluster */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge value={vm.criticality} type="criticality" size="sm" />
        {vm.environment && <Badge value={vm.environment} type="environment" size="sm" />}
        {vm.lifecycle && <Badge value={vm.lifecycle} type="lifecycle" size="sm" />}
        {vm.os_family && <Badge value={vm.os_family} type="os_family" size="sm" />}
        {vm.owner && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--color-text-secondary)]">{vm.owner}</span>}
        {vm.tags && vm.tags.length > 0 && (
          <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] text-[var(--color-text-tertiary)]">
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
  canEdit = false,
  onUpdateCell,
}: {
  vms: Vm[];
  columns: { key: string }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  canEdit?: boolean;
  onUpdateCell?: (vmId: string, field: string, value: string) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [editingCell, setEditingCell] = useState<{ vmId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startEdit = (vmId: string, field: string, initialVal: string) => {
    if (!canEdit) return;
    setEditingCell({ vmId, field });
    setEditValue(initialVal ?? '');
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const commitEdit = async () => {
    if (!editingCell || !onUpdateCell) return;
    try {
      setIsSaving(true);
      await onUpdateCell(editingCell.vmId, editingCell.field, editValue);
    } catch {
      // handled by parent toast/alert
    } finally {
      setIsSaving(false);
      setEditingCell(null);
    }
  };
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < vms.length;
  }, [selectedIds, vms.length]);


  return (
    <div className={tableWrapClass}>
      <table className={tableClass} style={{ '--row-height': 'var(--row-height-comfortable)' } as React.CSSProperties}>
        <thead className={tableHeadClass}>
          <tr>
            <th scope="col" className="px-4 py-3 w-10">
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
                <th key={col.key} scope="col" className="px-4 py-3" aria-sort={ariaSort}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.08em] text-[0.7rem] hover:text-[var(--color-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded"
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
                style={{ borderLeft: `3px solid var(--color-status-${vm.status.toLowerCase().replace(/\s+/g, '_')})` }}
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
                {columns.map((col) => {
                  const isEditing = editingCell?.vmId === vm.id && editingCell?.field === col.key;
                  const isEditable = canEdit && ['status', 'environment', 'criticality', 'lifecycle', 'owner'].includes(col.key);

                  return (
                    <td
                      key={col.key}
                      data-testid={`cell-${col.key}`}
                      className={cn(
                        tableCellClass,
                        col.key === 'name' && 'font-medium',
                        isEditable && !isEditing && 'group/cell cursor-pointer hover:bg-[var(--color-accent)]/10 transition-colors'
                      )}
                      title={isEditable && !isEditing ? 'Click to edit inline' : undefined}
                      onClick={() => {
                        if (isEditable && !isEditing) {
                          const currentVal = (vm as any)[col.key] ?? '';
                          startEdit(vm.id, col.key, currentVal);
                        }
                      }}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {col.key === 'status' && (
                            <select
                              autoFocus
                              className={selectClass}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['running', 'powered_off', 'decommissioned'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'environment' && (
                            <select
                              autoFocus
                              className={selectClass}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'criticality' && (
                            <select
                              autoFocus
                              className={selectClass}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['critical', 'high', 'medium', 'low'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'lifecycle' && (
                            <select
                              autoFocus
                              className={selectClass}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['planned', 'active', 'retiring', 'retired'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'owner' && (
                            <input
                              autoFocus
                              type="text"
                              className={inputClass}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            />
                          )}
                        </div>
                      ) : (
                        <>
                          {col.key === 'name' && (
                            <Link href={`/inventory/${vm.id}`} className={cn(monoClass, "font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent-text)]")}>
                              {vm.name}
                            </Link>
                          )}
                          {col.key === 'platform' && <Badge value={vm.platform} type="platform" />}
                          {col.key === 'cluster' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.cluster}</span>}
                          {col.key === 'node' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.node}</span>}
                          {col.key === 'status' && <Badge value={vm.status} type="status" />}
                          {col.key === 'environment' && <Badge value={vm.environment} type="environment" />}
                          {col.key === 'criticality' && <Badge value={vm.criticality} type="criticality" />}
                          {col.key === 'lifecycle' && <Badge value={vm.lifecycle} type="lifecycle" />}
                          {col.key === 'os_family' && <Badge value={vm.os_family ?? 'unknown'} type="os_family" />}
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
                        </>
                      )}
                    </td>
                  );
                })}
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
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | undefined>();
  const [bulkSuccess, setBulkSuccess] = useState<string | undefined>();
  const [bulkFailureDetails, setBulkFailureDetails] = useState<BulkResult | null>(null);
  const [pendingPatch, setPendingPatch] = useState<BulkPatch | null>(null);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const queryClient = useQueryClient();
  const { columns: colPrefs, visibleColumns, toggleColumn, reorderColumns, resetToDefault } = useColumnPreferences('inventory-list');

  const updateVmCellMutation = useMutation({
    mutationFn: ({ vmId, patch }: { vmId: string; patch: Record<string, unknown> }) =>
      api.updateVm(vmId, patch as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });

  const handleUpdateCell = async (vmId: string, field: string, value: string) => {
    await updateVmCellMutation.mutateAsync({ vmId, patch: { [field]: value } });
  };

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
    setSelectAllMatching(false);
  }

  function handlePageChange(page: number) {
    pushView({ ...view, page });
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectAllMatching(false);
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
    setSelectAllMatching(false);
  }

  const queryParams = useMemo(
    () => queryParamsFor(filtersFromParams(searchParams), viewFromParams(searchParams)),
    [searchParams],
  );
  function exportSelected(format: 'csv' | 'xlsx' = 'csv') {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds], format);
  }
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentFilters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const hasFilterChanges = useMemo(
    () => filterNames.some((name) => filters[name].join(',') !== currentFilters[name].join(',')),
    [filters, currentFilters],
  );

  useEffect(() => {
    if (!hasFilterChanges) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = paramsFromFilters(filters, { ...viewFromParams(searchParams), page: 1 });
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, hasFilterChanges, pathname, router, searchParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(filters, { ...viewFromParams(searchParams), page: 1 });
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  function clearFilters() {
    setFilters(emptyFilters());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(emptyFilters(), { ...viewFromParams(searchParams), page: 1 });
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const items = vms.data?.items ?? [];
  const total = vms.data?.total ?? items.length;
  const pageFullySelected = items.length > 0 && selectedIds.size === items.length;
  const targetCount = selectAllMatching ? total : selectedIds.size;
  const targetLabel = selectAllMatching
    ? `all ${total.toLocaleString()} matching VMs`
    : `${selectedIds.size} VM${selectedIds.size === 1 ? '' : 's'}`;

  function bulkFilters(): Record<string, unknown> {
    const active = filtersFromParams(searchParams);
    const payload: Record<string, unknown> = {};
    for (const name of filterNames) {
      if (active[name].length === 0) continue;
      payload[name] = name === 'q' ? active[name][0] : active[name];
    }
    return payload;
  }

  const bulkMutation = useMutation({
    mutationFn: (patch: BulkPatch) =>
      api.bulkUpdateVms(
        selectAllMatching ? { filters: bulkFilters(), patch } : { ids: [...selectedIds], patch },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      setBulkOpen(false);
      setConfirmBulkOpen(false);
      setPendingPatch(null);
      setSelectedIds(new Set());
      setSelectAllMatching(false);
      if (result.failed.length === 0) {
        setBulkSuccess(`Successfully updated ${result.updated} VM${result.updated === 1 ? '' : 's'}.`);
        setBulkError(undefined);
        setBulkFailureDetails(null);
      } else {
        setBulkError(`${result.updated} updated, ${result.failed.length} failed`);
        setBulkFailureDetails(result);
        setBulkSuccess(undefined);
      }
    },
  });

  function handleBulkSubmit(patch: BulkPatch) {
    setBulkError(undefined);
    setBulkSuccess(undefined);
    if (selectAllMatching || targetCount > 10) {
      setPendingPatch(patch);
      setConfirmBulkOpen(true);
    } else {
      bulkMutation.mutate(patch);
    }
  }

  // A stale deep link can point past the end of a shrunken result set.
  useEffect(() => {
    if (!vms.data) return;
    const lastPage = Math.max(1, Math.ceil(total / view.size));
    if (view.page > lastPage) pushView({ ...view, page: lastPage });
  }, [vms.data, total, view.size, view.page]);
  useEffect(() => {
    if (!bulkSuccess) return;
    const timer = setTimeout(() => {
      setBulkSuccess(undefined);
    }, 15000);
    return () => clearTimeout(timer);
  }, [bulkSuccess]);

  return (
    <PageTransition>
      <section>
        <PageHeader
          title="Inventory"
          context="Virtual machines"
          description="Search, compare, and update the documented fleet."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <details className="relative">
                <summary className={`${secondaryButtonClass} cursor-pointer list-none`}>Export</summary>
                <div className="absolute right-0 z-20 mt-2 grid min-w-44 gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-overlay)]">
                  <a href={api.exportVmsUrl(queryParams, 'csv')} download="vm-inventory.csv" className="rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface-tertiary)]">CSV</a>
                  <a href={api.exportVmsUrl(queryParams, 'xlsx')} download="vm-inventory.xlsx" className="rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface-tertiary)]">Excel</a>
                </div>
              </details>
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

        {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
        {bulkSuccess ? <Alert tone="success">{bulkSuccess}</Alert> : null}
        {bulkError && !bulkFailureDetails ? <Alert tone="error">{bulkError}</Alert> : null}
        {bulkFailureDetails && bulkFailureDetails.failed.length > 0 && (
          <div role="alert" className="mb-4 rounded-xl border border-[var(--color-criticality-critical)]/40 bg-[var(--color-criticality-critical-bg)] p-4 text-sm text-[var(--color-criticality-critical)]">
            <div className="flex items-center justify-between gap-3 font-semibold mb-2">
              <span>Bulk update completed with errors ({bulkFailureDetails.updated} updated, {bulkFailureDetails.failed.length} failed)</span>
              <button
                type="button"
                className="rounded-lg bg-[var(--color-criticality-critical)] px-3 py-1 text-xs font-semibold text-[var(--color-on-danger)] hover:opacity-90 transition-colors"
                onClick={() => {
                  setSelectedIds(new Set(bulkFailureDetails.failed.map((f: { id: string; message: string }) => f.id)));
                  setSelectAllMatching(false);
                }}
              >
                Select Failed ({bulkFailureDetails.failed.length})
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1 text-xs font-mono">
              {bulkFailureDetails.failed.map((f: { id: string; message: string }) => (
                <div key={f.id} className="flex justify-between items-center border-b border-[var(--color-criticality-critical)]/20 pb-1">
                  <span>VM ID: {f.id}</span>
                  <span className="text-[var(--color-criticality-critical)] font-semibold">{f.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
                canEdit={canCreateVm}
                onUpdateCell={handleUpdateCell}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {vms.data.items.map((vm) => (
                <VmCard key={vm.id} vm={vm} />
              ))}
            </div>
          </>
        ) : null}
        {vms.data && vms.data.items.length > 0 ? (
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
      {(selectedIds.size > 0 || selectAllMatching) && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-40 bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-inverse)] px-4 py-2.5 text-[var(--color-text-inverse)] shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-semibold tabular-nums">
              {selectAllMatching ? `All ${total.toLocaleString()} matching filters` : `${selectedIds.size} selected`}
            </span>
            {!selectAllMatching && pageFullySelected && total > items.length && (
              <button type="button" onClick={() => setSelectAllMatching(true)} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
                Select all {total.toLocaleString()} matching filters
              </button>
            )}
            {canCreateVm && targetCount > 0 && (
              <button type="button" onClick={() => { setBulkError(undefined); setBulkSuccess(undefined); setBulkOpen(true); }} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
                Edit
              </button>
            )}
            <div className="h-4 w-px bg-[var(--color-text-inverse)]/20" aria-hidden="true" />
            <button type="button" onClick={() => exportSelected('csv')} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
              CSV
            </button>
            <button type="button" onClick={() => exportSelected('xlsx')} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
              Excel
            </button>
            <button type="button" onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); }} className="text-sm font-medium text-[var(--color-text-inverse)]/60 hover:text-[var(--color-text-inverse)] transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

      <BulkEditDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        targetLabel={targetLabel}
        onSubmit={handleBulkSubmit}
        pending={bulkMutation.isPending}
        error={bulkError}
      />
      <ConfirmDialog
        open={confirmBulkOpen}
        title="Confirm Bulk Update"
        body={`Are you sure you want to apply these changes to ${targetLabel}? This operation will modify ${targetCount} virtual machine records.`}
        confirmLabel="Confirm Bulk Edit"
        tone="primary"
        onConfirm={() => {
          if (pendingPatch) bulkMutation.mutate(pendingPatch);
        }}
        onCancel={() => {
          setConfirmBulkOpen(false);
          setPendingPatch(null);
        }}
      >
        {pendingPatch && Object.keys(pendingPatch).length > 0 && (
          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1.5">
              Staged Changes Preview
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {Object.entries(pendingPatch).map(([key, val]) => (
                <div key={key} className="flex justify-between items-center gap-2 border-b border-[var(--color-border)]/50 pb-1 last:border-0 last:pb-0">
                  <span className="text-[var(--color-text-secondary)] font-medium">{key.replace(/_/g, ' ')}:</span>
                  <span className="font-mono text-[var(--color-accent-text)] font-semibold">
                    {Array.isArray(val) ? val.join(', ') : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </PageTransition>
  );
}
