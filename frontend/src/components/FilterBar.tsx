'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { FuzzyMultiSelect } from './FuzzyMultiSelect';
import { secondaryButtonClass, labelClass, inputClass } from './ui';
import { cn } from '../lib/classNames';
import type { Filters, FilterName } from '../routes/InventoryPage';
import { useClickOutside } from '../hooks/useClickOutside';
import { FilterChip, Drawer, DensityToggle } from './ui';

type AdvancedFilterName = Exclude<FilterName, 'q'>;

type AdvancedFieldConfig =
  | { kind: 'multiSelect'; options: readonly string[]; labels?: Record<string, string> }
  | { kind: 'dynamicMultiSelect'; labels?: Record<string, string> };

const filterGroups: { label: string; filters: AdvancedFilterName[] }[] = [
  { label: 'Infrastructure', filters: ['cluster', 'node', 'platform'] },
  { label: 'Lifecycle & State', filters: ['status', 'lifecycle', 'criticality', 'health'] },
  { label: 'Ownership & Environment', filters: ['environment', 'owner', 'os_family', 'application', 'tag'] },
  { label: 'Features', filters: ['monitoring_enabled', 'pmp_enabled'] },
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
const singleSelectFilters: AdvancedFilterName[] = ['health'];
const coreFilters = ['status', 'platform', 'criticality'] as const;
const coreFilterTypes: Record<typeof coreFilters[number], 'status' | 'criticality' | 'platform'> = {
  status: 'status',
  platform: 'platform',
  criticality: 'criticality',
};

const presetFilters = [
  { id: 'my-vms', label: 'My VMs', filters: { owner: ['me'] } as Partial<Filters> },
  { id: 'prod-critical', label: 'Production Critical', filters: { environment: ['production'], criticality: ['critical', 'high'] } as Partial<Filters> },
  { id: 'needs-attention', label: 'Needs Attention', filters: { status: ['suspended', 'archived'], health: ['warning', 'critical'] } as Partial<Filters> },
  { id: 'running-prod', label: 'Running in Prod', filters: { status: ['running'], environment: ['production'] } as Partial<Filters> },
];

export function FilterBar({
  filters,
  onApply,
  onDensityChange,
  density,
}: {
  filters: Filters;
  onApply: (filters: Filters) => void;
  onDensityChange: (density: 'comfortable' | 'compact' | 'condensed') => void;
  density: 'comfortable' | 'compact' | 'condensed';
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsRef = useClickOutside<HTMLDivElement>(() => setPresetsOpen(false));
  const [advancedFilters, setAdvancedFilters] = useState<Partial<Filters>>({});
  const [searchQuery, setSearchQuery] = useState(filters.q[0] || '');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const adv: Partial<Filters> = {};
    (Object.keys(filters) as FilterName[]).forEach((key) => {
      if (key !== 'q' && key !== 'platform' && key !== 'status' && key !== 'criticality' && filters[key].length > 0) {
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

  const handlePresetApply = (presetFilters: Partial<Filters>) => {
    const merged = { ...filters, ...presetFilters };
    onApply(merged);
    setAdvancedFilters(presetFilters);
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

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  const renderCoreChips = () => (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Core filters">
      {coreFilters.map((name) => {
        const config = advancedFilterConfig[name];
        const type = coreFilterTypes[name];
        const values = filters[name];
        const label = advancedFilterLabels[name];
        if (config.kind !== 'multiSelect') return null;
        return (
          <div key={name} className="flex items-center gap-1.5">
            <label htmlFor={`core-${name}`} className="sr-only">{label}</label>
            <FuzzyMultiSelect
              value={values}
              options={[...config.options] as string[]}
              onChange={(v) => handleCoreFilterChange(name, v)}
              placeholder={label}
            />
            {values.length > 0 && (
              <span className="text-xs text-[var(--color-text-tertiary)] dark:text-slate-400" aria-hidden="true">
                {values.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderActiveChips = () => (
    <div className="flex flex-wrap items-center gap-2 min-h-[28px]" role="group" aria-label="Active filters">
      {(Object.keys(filters) as FilterName[]).flatMap((name) => {
        const values = filters[name];
        if (name === 'q' || values.length === 0) return [];
        if ((coreFilters as readonly string[]).includes(name)) return []; // Core filters shown above
        const type = name as 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle';
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
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAllFilters}
          className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-criticality-critical)] transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );

  const renderAdvancedDrawer = () => (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Advanced Filters">
      <div className="space-y-6">
        {filterGroups.map((group) => (
          <fieldset key={group.label} className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)] dark:text-slate-400">
              {group.label}
            </legend>
            {group.filters.map((name) => {
              const config = advancedFilterConfig[name];
              const values = (advancedFilters[name] as string[]) || filters[name] || [];
              const options = config.kind === 'dynamicMultiSelect'
                ? []
                : config.options;
              const labels = config.labels;
              const isSingle = singleSelectFilters.includes(name);

              if (!options.length && config.kind === 'dynamicMultiSelect') {
                return (
                  <div key={name} className="space-y-2">
                    <label className={labelClass}>{advancedFilterLabels[name]}</label>
                    <div className="text-sm text-[var(--color-text-tertiary)] dark:text-slate-400">Loading…</div>
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
        <div className="pt-4 border-t border-[var(--color-border)] flex gap-2 justify-end">
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
      </div>
    </Drawer>
  );

  return (
    <>
      <div className="sticky top-16 z-30 bg-gradient-to-r from-indigo-50/50 via-white to-white dark:from-slate-800/50 dark:via-slate-900 dark:to-slate-950 backdrop-blur-lg border-b-2 border-indigo-300 dark:border-indigo-600 px-4 py-5 sm:px-6 lg:px-8 shadow-md dark:shadow-lg dark:shadow-slate-950/50">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full">
          {/* Search */}
          <div className="relative flex-1 min-w-0 max-w-xs sm:max-w-sm">
            <label htmlFor="search" className="sr-only">Search VMs</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M11 11l3.5 3.5" />
              </svg>
              <input
                ref={searchRef}
                id="search"
                type="search"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search name, IP, FQDN…"
                className={cn(inputClass, 'pl-9 pr-4')}
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

          {/* Core filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {renderCoreChips()}
          </div>

          {/* Presets dropdown */}
          <div className="relative" role="group" aria-label="Filter presets" ref={presetsRef}>
            <button
              type="button"
              onClick={() => setPresetsOpen((prev) => !prev)}
              className={secondaryButtonClass}
              aria-haspopup="true"
              aria-expanded={presetsOpen}
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 5h10M3 8h10M3 11h7" />
              </svg>
              <span>Presets</span>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 6l3 3 3-3" />
              </svg>
            </button>
            {presetsOpen && (
              <div className="absolute right-0 top-full mt-1.5 min-w-[180px] rounded-lg border border-[var(--color-border)] bg-white p-2 shadow-lg dark:bg-slate-900 dark:border-[var(--color-border)] animate-fade-in">
                {presetFilters.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      handlePresetApply(preset.filters);
                      setPresetsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-md text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors dark:hover:bg-slate-800"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Advanced filters trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={secondaryButtonClass}
            aria-label="Open advanced filters"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M6 8h4M8 6v4" />
            </svg>
            <span>More</span>
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M5 6l3 3 3-3" />
            </svg>
          </button>

          {/* Density toggle */}
          <DensityToggle value={density} onChange={onDensityChange} />
        </div>

        {/* Active filter chips row */}
        {hasActiveFilters && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)] animate-fade-in">
            {renderActiveChips()}
          </div>
        )}
      </div>

      {renderAdvancedDrawer()}
    </>
  );
}