'use client';

import { canEditInventory } from '../lib/permissions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { vms as vmsApi } from '../api/vms';
import { ApiError, detailMessage } from '../api/core';
import type { BulkResult, Vm, VmPayload } from '../api/types';
import { BulkEditDrawer } from '../components/BulkEditDrawer';
import type { BulkPatch } from '../api/types';
import { useCurrentUser } from '../components/AuthContext';
import { VmCard } from '../components/VmCard';
import { EditableField, VmTable } from '../components/VmTable';
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
import { ExportDrawer } from '../components/ExportDrawer';
import { columnsFromList } from '../lib/exportOptions';
import { PaginationFooter } from '../components/PaginationFooter';
import {
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
import { cn } from '../lib/classNames';

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
  const canCreateVm = canEditInventory(user.role);
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams));
  const [view, setView] = useState<ViewState>(() => viewFromParams(searchParams));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cellError, setCellError] = useState<string | undefined>();
  const [bulkError, setBulkError] = useState<string | undefined>();
  const [bulkSuccess, setBulkSuccess] = useState<string | undefined>();
  const [bulkFailureDetails, setBulkFailureDetails] = useState<BulkResult | null>(null);
  const [pendingPatch, setPendingPatch] = useState<BulkPatch | null>(null);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    targets: Pick<Vm, 'id' | 'name'>[];
    requestId: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const queryClient = useQueryClient();
  const [exportOpen, setExportOpen] = useState(false);
  const { columns: colPrefs, visibleColumns, toggleColumn, reorderColumns, resetToDefault } = useColumnPreferences('inventory-list');

  const updateVmCellMutation = useMutation({
    mutationFn: ({ vmId, patch }: { vmId: string; patch: Partial<VmPayload> }) =>
      vmsApi.updateVm(vmId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });

  const handleUpdateCell = async (vmId: string, field: EditableField, value: string) => {
    try {
      setCellError(undefined);
      const patch = { [field]: value } as Partial<VmPayload>;
      await updateVmCellMutation.mutateAsync({ vmId, patch });
    } catch (err) {
      setCellError(detailMessage(err));
      throw err;
    }
  };

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
    setView(viewFromParams(searchParams));
  }, [searchParams]);

  function pushView(next: ViewState, replace = false) {
    setView(next);
    const params = paramsFromFilters(filtersFromParams(searchParams), next);
    const target = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    if (replace) {
      router.replace(target);
    } else {
      router.push(target);
    }
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
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => vmsApi.listVms(queryParams) });
  const suggestionsQuery = useQuery({ queryKey: ['vm-suggestions'], queryFn: vmsApi.listVmSuggestions });
  const clustersQuery = useQuery({ queryKey: ['vm-clusters'], queryFn: vmsApi.listVmClusters });
  const nodesQuery = useQuery({ queryKey: ['vm-nodes'], queryFn: vmsApi.listVmNodes });
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: vmsApi.listVmOwners });
  const tagsQuery = useQuery({ queryKey: ['vm-tags'], queryFn: vmsApi.listVmTags });

  const bulkSuggestions = useMemo(() => ({
    ...(suggestionsQuery.data ?? {}),
    cluster: clustersQuery.data ?? [],
    node: nodesQuery.data ?? [],
    owner: ownersQuery.data ?? [],
  }), [suggestionsQuery.data, clustersQuery.data, nodesQuery.data, ownersQuery.data]);
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
      router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, hasFilterChanges, pathname, router, searchParams]);

  function clearFilters() {
    setFilters(emptyFilters());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const params = paramsFromFilters(emptyFilters(), { ...viewFromParams(searchParams), page: 1 });
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const items = vms.data?.items ?? [];
  const canDeleteSelected = user.role === 'admin' && !selectAllMatching && items.some((vm) => selectedIds.has(vm.id));
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

  function invalidateInventory() {
    for (const key of ['vms', 'vm-owners', 'vm-suggestions', 'vm-clusters', 'vm-nodes', 'vm-tags']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  function openBulkDelete() {
    if (!canDeleteSelected) return;
    const targets = items.filter(({ id }) => selectedIds.has(id)).map(({ id, name }) => ({ id, name }));
    // getRandomValues is available on HTTP origins where randomUUID is unavailable.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    setDeleteConfirmation({ targets, requestId });
    setDeleteError(undefined);
    setBulkError(undefined);
    setBulkSuccess(undefined);
    setBulkFailureDetails(null);
  }

  const closeBulkDelete = useCallback(() => setDeleteConfirmation(null), []);
  const deleteTargets = deleteConfirmation?.targets ?? [];

  async function deleteSelected() {
    if (!deleteConfirmation) return;
    const ids = deleteConfirmation.targets.map(({ id }) => id);
    setDeleteError(undefined);
    try {
      await vmsApi.bulkDeleteVms({ ids, request_id: deleteConfirmation.requestId });
      setBulkSuccess(`Deleted ${ids.length} VM record${ids.length === 1 ? '' : 's'}.`);
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: ['vm', id] });
      void queryClient.invalidateQueries({ queryKey: ['vm-export-preview'] });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setDeleteError('Deletion may have completed. Press and hold for 2 seconds to retry.');
        return;
      }
      if (error.status !== 409) {
        setDeleteError(detailMessage(error));
        return;
      }
      setBulkError('The selection is stale. The inventory is being refreshed. Select the VM records again.');
    }
    closeBulkDelete();
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    invalidateInventory();
  }

  const bulkMutation = useMutation({
    mutationFn: (patch: BulkPatch) =>
      vmsApi.bulkUpdateVms(
        selectAllMatching ? { filters: bulkFilters(), patch } : { ids: [...selectedIds], patch },
      ),
    onSuccess: (result) => {
      invalidateInventory();
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
    if (view.page > lastPage) pushView({ ...view, page: lastPage }, true);
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
      <section className={cn((selectedIds.size > 0 || selectAllMatching) && 'pb-28')}>
        <PageHeader
          title="Inventory"
          context="Virtual machines"
          description="Search, compare, and update the documented fleet."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setExportOpen(true)}>Export</button>
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
        {cellError ? <Alert tone="error">{cellError}</Alert> : null}
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
            {canDeleteSelected && (
              <button type="button" onClick={openBulkDelete} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
                Delete selected
              </button>
            )}
            <div className="h-4 w-px bg-[var(--color-text-inverse)]/20" aria-hidden="true" />
            <button type="button" onClick={() => setExportOpen(true)} className="text-sm font-medium text-[var(--color-text-inverse)]/90 hover:text-[var(--color-text-inverse)] transition-colors">
              Export
            </button>
            <button type="button" onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); }} className="text-sm font-medium text-[var(--color-text-inverse)]/60 hover:text-[var(--color-text-inverse)] transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}
      <ExportDrawer
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filters={filters}
        selectedIds={selectAllMatching ? [] : [...selectedIds]}
        initialColumns={columnsFromList(colPrefs)}
      />

      <BulkEditDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        targetLabel={targetLabel}
        onSubmit={handleBulkSubmit}
        pending={bulkMutation.isPending}
        error={bulkError}
        suggestions={bulkSuggestions}
        tagOptions={tagsQuery.data ?? []}
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
      <ConfirmDialog
        open={deleteConfirmation !== null}
        title={`Delete ${deleteTargets.length} selected VM${deleteTargets.length === 1 ? '' : 's'}?`}
        body="This permanently deletes these records from InventoryMGR only. Press and hold for 2 seconds to confirm."
        confirmLabel="Hold to delete"
        onHoldConfirm={deleteSelected}
        onCancel={closeBulkDelete}
      >
        <ul aria-label="VMs to delete" tabIndex={0} className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm break-all">
          {deleteTargets.map(({ id, name }) => <li key={id}>{name}</li>)}
        </ul>
        {deleteError ? <div className="mt-3"><Alert tone="error">{deleteError}</Alert></div> : null}
      </ConfirmDialog>
    </PageTransition>
  );
}
