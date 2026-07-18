'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/classNames';
import { eyebrowClass, filterBarClass, inputClass, secondaryButtonClass } from './ui';
import { ColumnDrawer } from './ColumnDrawer';
import { ActiveFilterChips } from './filters/ActiveFilterChips';
import { FilterDrawer } from './filters/FilterDrawer';
import { emptyFilterState } from './filters/filterConfig';
import type { ColumnConfig } from '../hooks/useColumnPreferences';
import type { Filters, FilterName } from '../routes/InventoryPage';

type OpenDrawer = 'none' | 'filters' | 'columns';

function activeFilterCount(filters: Filters): number {
  return (Object.keys(filters) as FilterName[])
    .filter((name) => name !== 'q')
    .reduce((total, name) => total + filters[name].length, 0);
}

export function InventoryToolbar({
  filters,
  onApply,
  columns,
  onToggleColumn,
  onReorderColumns,
  onResetColumns,
}: {
  filters: Filters;
  onApply: (filters: Filters) => void;
  columns: ColumnConfig[];
  onToggleColumn: (key: string) => void;
  onReorderColumns: (fromKey: string, toKey: string) => void;
  onResetColumns: () => void;
}) {
  // Only one drawer at a time — opening one closes the other.
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>('none');
  const [searchQuery, setSearchQuery] = useState(filters.q[0] ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchQuery(filters.q[0] ?? '');
  }, [filters.q]);

  const count = activeFilterCount(filters);
  const visibleColumnCount = columns.filter((c) => c.visible).length;

  function commitSearch(value: string) {
    setSearchQuery(value);
    onApply({ ...filters, q: value ? [value] : [] });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      searchRef.current?.blur();
      commitSearch('');
    }
  }

  function removeChip(name: Exclude<FilterName, 'q'>, value: string) {
    onApply({ ...filters, [name]: filters[name].filter((v) => v !== value) });
  }

  function clearAllFilters() {
    // Search is card-owned and survives Clear all; only facets are reset.
    onApply({ ...emptyFilterState, q: filters.q });
  }

  return (
    <>
      <div className={filterBarClass} role="search" aria-label="Inventory filters">
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--color-accent)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M2 3h12M4.5 8h7M7 13h2" strokeLinecap="round" />
          </svg>
          <span className={cn(eyebrowClass, 'text-[var(--color-accent)]')}>Filter &amp; Search</span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <path d="M10 10l4 4" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(e) => commitSearch(e.currentTarget.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by name, IP, hostname…"
              className={cn(inputClass, 'pl-10 pr-10')}
              aria-label="Search VMs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => commitSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenDrawer('filters')}
              className={cn(
                secondaryButtonClass,
                count > 0 && 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
              )}
              aria-haspopup="dialog"
              aria-expanded={openDrawer === 'filters'}
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 4h12M4.5 8h7M7 12h2" strokeLinecap="round" />
              </svg>
              <span>Filters</span>
              {count > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[0.6875rem] font-semibold text-white">
                  {count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setOpenDrawer('columns')}
              className={secondaryButtonClass}
              aria-haspopup="dialog"
              aria-expanded={openDrawer === 'columns'}
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <line x1="6" y1="2" x2="6" y2="14" />
                <line x1="10" y1="2" x2="10" y2="14" />
              </svg>
              <span>Columns</span>
              {visibleColumnCount < columns.length && (
                <span className="text-xs text-[var(--color-text-tertiary)] dark:text-slate-400">
                  {visibleColumnCount}/{columns.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {count > 0 && (
          <div className="mt-3 flex animate-fade-in items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <div className="min-w-0 flex-1">
              <ActiveFilterChips filters={filters} onRemove={removeChip} />
            </div>
            <button
              type="button"
              onClick={clearAllFilters}
              className={cn(secondaryButtonClass, 'flex-shrink-0 text-xs')}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <FilterDrawer
        open={openDrawer === 'filters'}
        filters={filters}
        onClose={() => setOpenDrawer('none')}
        onApply={onApply}
      />
      <ColumnDrawer
        open={openDrawer === 'columns'}
        columns={columns}
        onClose={() => setOpenDrawer('none')}
        onToggle={onToggleColumn}
        onReorder={onReorderColumns}
        onReset={onResetColumns}
      />
    </>
  );
}
