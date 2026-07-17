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
  inputClass,
  monoClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableRowClass,
  tableWrapClass,
} from '../components/ui';
import { ColumnEditor } from '../components/ColumnEditor';
import { useColumnPreferences, COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { formatMemory } from '../lib/units';
import { useFilterPresets } from '../hooks/useFilterPresets';
import { FilterBar } from '../components/FilterBar';

export const coreFilterNames = ['q', 'platform', 'status', 'criticality'] as const;
export const advancedFilterNames = ['cluster', 'lifecycle', 'environment', 'monitoring_enabled', 'node', 'os_family', 'owner', 'pmp_enabled', 'tag', 'application', 'health'] as const;
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
    health: [],
  };
}

function paramsFromFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const values = filters[name];
    if (values.length > 0) {
      values.forEach((v) => params.append(name, v));
    }
  }
  params.set('limit', '50');
  params.set('offset', '0');
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


function VmCard({ vm }: { vm: Vm }) {
  return (
    <article
      className={cn(cardClass, 'p-4 transition-colors duration-150')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-[var(--color-text-primary)] truncate">{vm.name}</h3>
          <p className={cn("mt-0.5 text-sm text-[var(--color-text-tertiary)]", monoClass)}>{vm.platform} / {vm.cluster}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge value={vm.status} type="status" />
          <Badge value={vm.criticality} type="criticality" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {vm.environment && <Badge value={vm.environment} type="environment" />}
        {vm.lifecycle && <Badge value={vm.lifecycle} type="lifecycle" />}
        {vm.os_family && <Badge value={vm.os_family} type="os_family" />}
        {vm.owner && <span className="inline-flex items-center rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">{vm.owner}</span>}
        {vm.tags && vm.tags.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-tertiary)]">
            {vm.tags.slice(0, 2).join(', ')}{vm.tags.length > 2 && ` +${vm.tags.length - 2}`}
          </span>
        )}
      </div>
    </article>
  );
}

function VmTable({
  vms,
  columns,
  selectedIds,
  onToggle,
  onToggleAll,
  density,
}: {
  vms: Vm[];
  columns: { key: string }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  density: 'comfortable' | 'compact' | 'condensed';
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={tableWrapClass}>
      <table className={tableClass} role="grid" style={{ '--row-height': `var(--row-height-${density})` } as React.CSSProperties}>
        <thead>
          <tr className={tableHeadClass}>
            <th className="px-4 py-3 w-10">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                checked={selectedIds.size === vms.length && vms.length > 0}
                onChange={() => onToggleAll(vms.map((v) => v.id))}
                aria-label="Select all"
              />
            </th>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3">
                <span className="font-medium">{COLUMN_LABELS[col.key as keyof typeof COLUMN_LABELS] || col.key}</span>
              </th>
            ))}
            <th className="px-4 py-3 w-24">Actions</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {vms.map((vm, index) => {
            const isSelected = selectedIds.has(vm.id);
            
            return (
              <tr
                key={vm.id}
                className={cn(
                  tableRowClass,
                  isSelected && 'bg-[var(--color-accent)]/10'
                )}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    checked={isSelected}
                    onChange={() => onToggle(vm.id)}
                    aria-label={`Select ${vm.name}`}
                  />
                </td>
                {columns.map((col) => (
                  <td key={col.key} className={cn(tableCellClass, col.key === 'name' && 'font-medium')}>
                    {col.key === 'name' && (
                      <Link href={`/inventory/${vm.id}`} className="hover:text-[var(--color-accent)] transition-colors">
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
                    {col.key === 'monitoring_enabled' && <Badge value={vm.monitoring_enabled ? 'Enabled' : 'Disabled'} type="status" />}
                    {col.key === 'pmp_enabled' && <Badge value={vm.pmp_enabled ? 'Enabled' : 'Disabled'} type="status" />}
                    {col.key === 'health' && <Badge value={vm.health_score >= 80 ? 'healthy' : vm.health_score >= 50 ? 'warning' : 'critical'} type="status" />}
                    {col.key === 'resources' && (
                      <span className={cn(monoClass, "truncate max-w-[200px]")}>{vm.cpu_cores} vCPU · {formatMemory(vm.memory_mb)}</span>
                    )}
                    {col.key === 'fqdn' && <span className={cn(monoClass, "truncate max-w-xs")}>{vm.fqdn ?? ''}</span>}
                    {col.key === 'ip_address' && <span className={monoClass}>{vm.networks?.[0]?.ip_address ?? ''}</span>}
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
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/inventory/${vm.id}`} className="px-2 py-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors" aria-label="View details">
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </Link>
                    <Link href={`/inventory/${vm.id}/edit`} className="px-2 py-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors" aria-label="Edit">
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3l3 3-8 8H3l-1-5 5-1 8-8-3-3Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </Link>
                  </div>
                </td>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<'comfortable' | 'compact' | 'condensed'>(() => {
    if (typeof window === 'undefined') return 'comfortable';
    return (localStorage.getItem('inventory-density') as 'comfortable' | 'compact' | 'condensed') || 'comfortable';
  });
  const { columns: colPrefs, visibleColumns, toggleColumn, reorderColumns, resetToDefault } = useColumnPreferences('inventory-list');
  const { presets, savePreset, deletePreset } = useFilterPresets<Filters, Record<string, string>>('inventory_presets');
  const [saveName, setSaveName] = useState('');

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

  const queryParams = useMemo(() => paramsFromFilters(filtersFromParams(searchParams)), [searchParams]);
  const exportFilteredUrl = api.exportVmsUrl(queryParams);
  function exportSelected() {
    if (selectedIds.size === 0) return;
    window.location.href = api.exportSelectedUrl([...selectedIds]);
  }
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: async () => {
    const result = await api.listVms(queryParams);
    return result;
  } });
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, pathname, router, searchParams]);

  useEffect(() => {
    localStorage.setItem('inventory-density', density);
    document.documentElement.style.setProperty('--row-height', `var(--row-height-${density})`);
  }, [density]);

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

  return (
    <PageTransition>
      <section>
        <PageHeader
          title="Inventory"
          eyebrow={vms.data && vms.data.items.length > 0 ? `${vms.data.items.length} VM${vms.data.items.length !== 1 ? 's' : ''}` : undefined}
          actions={
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
          }
        />
        <FilterBar filters={filters} onApply={setFilters} density={density} onDensityChange={setDensity} />
        <div className={cardClass}>
          <div className="flex flex-wrap items-center gap-3">
            <ColumnEditor columns={colPrefs} onToggle={toggleColumn} onReorder={reorderColumns} onReset={resetToDefault} />
            {Object.keys(presets).length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className={selectClass}
                  onChange={(e) => {
                    if (e.target.value && presets[e.target.value]) {
                      setFilters(presets[e.target.value].filters);
                    }
                    e.target.value = '';
                  }}
                  defaultValue=""
                  aria-label="Load filter preset"
                >
                  <option value="" disabled>Load preset…</option>
                  {Object.keys(presets).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (saveName.trim()) {
                      savePreset(saveName.trim(), filters, {});
                      setSaveName('');
                    }
                  }}
                >
                  <input
                    className={cn(inputClass, "w-40")}
                    placeholder="Preset name"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button type="submit" disabled={!saveName.trim()} className={secondaryButtonClass}>
                    Save
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {vms.isError ? <Alert>{detailMessage(vms.error)}</Alert> : null}
        {vms.isLoading ? <TableSkeleton rows={8} cols={7} /> : null}
        {vms.data && vms.data.items.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <VmTable vms={vms.data.items} columns={visibleColumns} selectedIds={selectedIds} onToggle={toggleSelect} onToggleAll={toggleSelectAll} density={density} />
            </div>
            <div className="grid gap-3 lg:hidden">
              {vms.data.items.map((vm) => (
                <VmCard key={vm.id} vm={vm} />
              ))}
            </div>
          </>
        ) : null}
        {vms.data && vms.data.items.length === 0 ? <EmptyState title="No VMs found" body="Create a VM or adjust the filters to see inventory." icon={<span className="text-6xl">📦</span>} /> : null}
      </section>
    </PageTransition>
  );
}
