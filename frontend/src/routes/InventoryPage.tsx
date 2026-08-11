'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { vms as vmsApi } from '../api/vms';
import { detailMessage } from '../api/core';
import type { Vm, BulkResult } from '../api/types';
import { BulkEditDrawer, BulkPatch } from '../components/BulkEditDrawer';
import { useCurrentUser } from '../components/AuthContext';
import { VmCard } from '../components/VmCard';
import { VmTable } from '../components/VmTable';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  PageTransition,
  TableSkeleton,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/ui';
import { useColumnPreferences } from '../hooks/useColumnPreferences';
import { InventoryToolbar } from '../components/InventoryToolbar';
import { PaginationFooter } from '../components/PaginationFooter';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  emptyFilters,
  filterNames,
  filtersFromParams,
  hasActiveFilters,
  paramsFromFilters,
  queryParamsFor,
  viewFromParams,
} from '../lib/inventoryFilters';
import type { Filters, ViewState } from '../lib/inventoryFilters';

export {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  SORTABLE_COLUMNS,
  advancedFilterNames,
  coreFilterNames,
  filterNames,
  paramsFromFilters,
  viewFromParams,
} from '../lib/inventoryFilters';
export type { FilterName, Filters, ViewState } from '../lib/inventoryFilters';


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
      vmsApi.updateVm(vmId, patch as any),
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
    window.location.href = vmsApi.exportSelectedUrl([...selectedIds], format);
  }
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => vmsApi.listVms(queryParams) });
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
      vmsApi.bulkUpdateVms(
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
                  <a href={vmsApi.exportVmsUrl(queryParams, 'csv')} download="vm-inventory.csv" className="rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface-tertiary)]">CSV</a>
                  <a href={vmsApi.exportVmsUrl(queryParams, 'xlsx')} download="vm-inventory.xlsx" className="rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface-tertiary)]">Excel</a>
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
