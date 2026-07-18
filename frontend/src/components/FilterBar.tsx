'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { FuzzyMultiSelect } from './FuzzyMultiSelect';
import { SegmentedControl } from './SegmentedControl';
import { secondaryButtonClass, labelClass, inputClass, filterBarClass, eyebrowClass } from './ui';
import { cn } from '../lib/classNames';
import type { Filters, FilterName } from '../routes/InventoryPage';
import { FilterChip, Drawer } from './ui';

type AdvancedFilterName = Exclude<FilterName, 'q'>;

type AdvancedFieldConfig =
  | { kind: 'multiSelect'; options: readonly string[]; labels?: Record<string, string> }
  | { kind: 'dynamicMultiSelect'; labels?: Record<string, string> };

/** Only high-cardinality, fleet-derived facets live in the drawer. Everything
 * with a fixed option list is rendered inline — see `inlineFilters`. */
const filterGroups: { label: string; filters: AdvancedFilterName[] }[] = [
  { label: 'Infrastructure', filters: ['cluster', 'node'] },
  { label: 'Ownership', filters: ['owner', 'application', 'tag'] },
];

const advancedFilterConfig: Record<AdvancedFilterName, AdvancedFieldConfig> = {
  status: { kind: 'multiSelect', options: ['running', 'powered_off', 'suspended', 'archived', 'decommissioned', 'unknown'] as const },
  platform: { kind: 'multiSelect', options: ['proxmox', 'vmware'] as const },
  criticality: { kind: 'multiSelect', options: ['critical', 'high', 'medium', 'low'] as const },
  lifecycle: { kind: 'multiSelect', options: ['active', 'planned', 'retiring', 'retired'] as const },
  environment: { kind: 'multiSelect', options: ['production', 'staging', 'uat', 'testing', 'development', 'dr', 'sandbox'] as const },
  cluster: { kind: 'dynamicMultiSelect' },
  node: { kind: 'dynamicMultiSelect' },
  os_family: { kind: 'multiSelect', options: ['linux', 'windows'] as const },
  owner: { kind: 'dynamicMultiSelect' },
  application: { kind: 'dynamicMultiSelect' },
  tag: { kind: 'dynamicMultiSelect' },
  monitoring_enabled: { kind: 'multiSelect', options: ['true', 'false'] as const, labels: { true: 'Enabled', false: 'Disabled' } },
  pmp_enabled: { kind: 'multiSelect', options: ['true', 'false'] as const, labels: { true: 'Enabled', false: 'Disabled' } },
  health: { kind: 'multiSelect', options: ['healthy', 'warning', 'critical', 'unknown'] as const },
};

const advancedFilterLabels: Record<AdvancedFilterName, string> = {
  status: 'Status',
  platform: 'Platform',
  criticality: 'Criticality',
  lifecycle: 'Lifecycle',
  environment: 'Environment',
  cluster: 'Cluster',
  node: 'Node',
  os_family: 'OS Family',
  owner: 'Owner',
  application: 'Application',
  tag: 'Tag',
  monitoring_enabled: 'Monitoring',
  pmp_enabled: 'PMP',
  health: 'Health',
};

const booleanFilters: AdvancedFilterName[] = ['monitoring_enabled', 'pmp_enabled'];
const dynamicMultiSelectFilters: AdvancedFilterName[] = ['owner', 'cluster', 'node', 'tag', 'application'];

const dynamicFetchers: Record<'owner' | 'cluster' | 'node' | 'tag' | 'application', () => Promise<string[]>> = {
  owner: api.listVmOwners,
  cluster: api.listVmClusters,
  node: api.listVmNodes,
  tag: api.listVmTags,
  application: api.listVmApplications,
};
const singleSelectFilters: AdvancedFilterName[] = ['health'];

/** Fixed-enum facets rendered directly in the bar. High-cardinality facets
 * (cluster/node/owner/tag/application) stay in the drawer — their options come
 * from the fleet and would overflow a segmented control. */
const inlineFilters = [
  'status', 'platform', 'criticality', 'lifecycle', 'environment',
  'os_family', 'health', 'monitoring_enabled', 'pmp_enabled',
] as const;

export function FilterBar({
  filters,
  onApply,
}: {
  filters: Filters;
  onApply: (filters: Filters) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<Partial<Filters>>({});
  const [searchQuery, setSearchQuery] = useState(filters.q[0] || '');
  const searchRef = useRef<HTMLInputElement>(null);

  // Dynamic facet options (cluster/node/owner/tag/application) come from the
  // fleet itself rather than a fixed enum, so fetch them once and reuse.
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: dynamicFetchers.owner, staleTime: 60_000 });
  const clustersQuery = useQuery({ queryKey: ['vm-clusters'], queryFn: dynamicFetchers.cluster, staleTime: 60_000 });
  const nodesQuery = useQuery({ queryKey: ['vm-nodes'], queryFn: dynamicFetchers.node, staleTime: 60_000 });
  const tagsQuery = useQuery({ queryKey: ['vm-tags'], queryFn: dynamicFetchers.tag, staleTime: 60_000 });
  const applicationsQuery = useQuery({ queryKey: ['vm-applications'], queryFn: dynamicFetchers.application, staleTime: 60_000 });
  const dynamicResults: Record<'owner' | 'cluster' | 'node' | 'tag' | 'application', { options: string[]; isLoading: boolean; isError: boolean }> = {
    owner: { options: ownersQuery.data ?? [], isLoading: ownersQuery.isLoading, isError: ownersQuery.isError },
    cluster: { options: clustersQuery.data ?? [], isLoading: clustersQuery.isLoading, isError: clustersQuery.isError },
    node: { options: nodesQuery.data ?? [], isLoading: nodesQuery.isLoading, isError: nodesQuery.isError },
    tag: { options: tagsQuery.data ?? [], isLoading: tagsQuery.isLoading, isError: tagsQuery.isError },
    application: { options: applicationsQuery.data ?? [], isLoading: applicationsQuery.isLoading, isError: applicationsQuery.isError },
  };
  useEffect(() => {
    const adv: Partial<Filters> = {};
    (Object.keys(filters) as FilterName[]).forEach((key) => {
      if (key !== 'q' && filters[key].length > 0) {
        adv[key] = filters[key];
      }
    });
    setAdvancedFilters(adv);
  }, [filters]);

  const handleCoreFilterChange = (name: AdvancedFilterName, values: string[]) => {
    onApply({ ...filters, [name]: values });
  };

  const handleSearchChange = (e: React.FormEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setSearchQuery(value);
    onApply({ ...filters, q: value ? [value] : [] });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      searchRef.current?.blur();
      setSearchQuery('');
      onApply({ ...filters, q: [] });
    }
  };

  const handleAdvancedApply = (newAdvFilters: Partial<Filters>) => {
    setAdvancedFilters(newAdvFilters);
    const merged = { ...filters, ...newAdvFilters };
    onApply(merged);
    setDrawerOpen(false);
  };

  const clearAllFilters = () => {
    const empty: Filters = {
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
    setAdvancedFilters({});
    setSearchQuery('');
    onApply(empty);
  };


  const renderInlineFilters = () => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filters">
      {inlineFilters.map((name) => {
        const config = advancedFilterConfig[name];
        if (config.kind !== 'multiSelect') return null;
        return (
          <div key={name} className="flex items-center gap-1.5">
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
              {advancedFilterLabels[name]}
            </span>
            <SegmentedControl
              label={advancedFilterLabels[name]}
              value={filters[name]}
              options={config.options}
              labels={config.labels}
              onChange={(v) => handleCoreFilterChange(name, v)}
            />
          </div>
        );
      })}
    </div>
  );

  const renderActiveChips = () => {
    return (
      <div className="flex flex-wrap items-center gap-2 min-h-[28px]" role="group" aria-label="Active filters">
        {(Object.keys(filters) as FilterName[]).flatMap((name) => {
          const values = filters[name];
          if (name === 'q' || values.length === 0) return [];
          // Determine semantic type for the chip color
          let type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle' = 'status';
          if (name === 'status') type = 'status';
          else if (name === 'criticality') type = 'criticality';
          else if (name === 'platform') type = 'platform';
          else if (name === 'environment') type = 'environment';
          else if (name === 'os_family') type = 'os_family';
          else if (name === 'lifecycle') type = 'lifecycle';
          else if (name === 'health') type = 'status';
          else if (name === 'monitoring_enabled') type = 'status';
          else if (name === 'pmp_enabled') type = 'status';
          return values.map((value) => {
            const fieldLabels = advancedFilterConfig[name as AdvancedFilterName].labels;
            return (
              <FilterChip
                key={`${name}-${value}`}
                label={advancedFilterLabels[name as AdvancedFilterName] || name}
                value={fieldLabels?.[value] ?? value}
                onRemove={() => {
                  const newValues = filters[name].filter((v) => v !== value);
                  onApply({ ...filters, [name]: newValues });
                }}
                type={type}
              />
            );
          });
        })}
      </div>
    );
  };

  const renderAdvancedDrawer = () => (
    <Drawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      title="Filters"
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryButtonClass} onClick={() => setDrawerOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
            onClick={() => handleAdvancedApply(advancedFilters)}
          >
            Apply ({Object.values(advancedFilters).flat().length})
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="space-y-2">
          <label className={labelClass}>Search</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <path d="M10 10l4 4" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by name, IP, hostname…"
              className={cn(inputClass, 'pl-10 pr-10')}
              autoFocus
              aria-label="Search VMs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); onApply({ ...filters, q: [] }); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Advanced filter groups */}
        {filterGroups.map((group) => (
          <fieldset key={group.label} className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)] dark:text-slate-400">
              {group.label}
            </legend>
            {group.filters.map((name) => {
              const config = advancedFilterConfig[name];
              const values = (advancedFilters[name] as string[]) || filters[name] || [];
              const dynamic = config.kind === 'dynamicMultiSelect'
                ? dynamicResults[name as 'owner' | 'cluster' | 'node' | 'tag' | 'application']
                : null;
              const options = config.kind === 'dynamicMultiSelect'
                ? dynamic!.options
                : config.options;
              const labels = config.labels;
              const isSingle = singleSelectFilters.includes(name);

              if (dynamic?.isLoading) {
                return (
                  <div key={name} className="space-y-2">
                    <label className={labelClass}>{advancedFilterLabels[name]}</label>
                    <div className="h-9 w-full animate-pulse rounded-lg bg-[var(--color-surface-tertiary)] dark:bg-slate-800" aria-label={`Loading ${advancedFilterLabels[name]} options`} />
                  </div>
                );
              }
              if (dynamic?.isError) {
                return (
                  <div key={name} className="space-y-2">
                    <label className={labelClass}>{advancedFilterLabels[name]}</label>
                    <div className="text-sm text-[var(--color-criticality-critical)]">Couldn&apos;t load {advancedFilterLabels[name].toLowerCase()} options.</div>
                  </div>
                );
              }
              if (dynamic && options.length === 0) {
                return (
                  <div key={name} className="space-y-2">
                    <label className={labelClass}>{advancedFilterLabels[name]}</label>
                    <div className="text-sm text-[var(--color-text-tertiary)] dark:text-slate-400">No {advancedFilterLabels[name].toLowerCase()} values in the fleet yet.</div>
                  </div>
                );
              }

              return (
                <div key={name} className="space-y-2">
                  <label className={labelClass}>{advancedFilterLabels[name]}</label>
                  <FuzzyMultiSelect
                    value={values}
                    options={[...options] as string[]}
                    onChange={(v) => setAdvancedFilters({ ...advancedFilters, [name]: v })}
                    placeholder={advancedFilterLabels[name]}
                    labels={labels}
                  />
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Drawer>
  );

  const hasActiveFilters = (Object.keys(filters) as FilterName[]).some((name) => {
    return filters[name].length > 0;
  });

  return (
    <>
      <div className={filterBarClass} role="search" aria-label="Inventory filters">
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--color-accent)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M2 3h12M4.5 8h7M7 13h2" strokeLinecap="round" />
          </svg>
          <span className={cn(eyebrowClass, 'text-[var(--color-accent)]')}>Filter &amp; Search</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search — visible at every breakpoint */}
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <path d="M10 10l4 4" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search…"
              className={cn(inputClass, 'pl-10 pr-10')}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); onApply({ ...filters, q: [] }); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
          {/* Right side: Filters trigger */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Filters drawer trigger */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cn(secondaryButtonClass, hasActiveFilters && 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]')}
              aria-label="Open filters"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M6 8h4M8 6v4" />
              </svg>
              <span>Filters</span>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 6l3 3 3-3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Inline enum facets — every fixed-option filter, no drawer round-trip */}
        <div className="mt-3">{renderInlineFilters()}</div>

        {/* Active filter chips row */}
        {hasActiveFilters && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)] animate-fade-in flex items-center gap-2 justify-between">
            <div className="flex-1">{renderActiveChips()}</div>
            <button
              type="button"
              onClick={clearAllFilters}
              className={cn(secondaryButtonClass, 'text-xs')}
              aria-label="Clear all"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {renderAdvancedDrawer()}
    </>
  );
}