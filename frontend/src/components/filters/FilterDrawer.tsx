'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, labelClass, secondaryButtonClass } from '../ui';
import { FuzzyMultiSelect } from '../FuzzyMultiSelect';
import { SegmentedControl } from '../SegmentedControl';
import { cn } from '../../lib/classNames';
import type { Filters } from '../../routes/InventoryPage';
import {
  advancedFilterConfig,
  advancedFilterLabels,
  coreFilterTypes,
  dynamicFetchers,
  filterGroups,
  type AdvancedFilterName,
  type CoreFilterName,
  type DynamicFilterName,
} from './filterConfig';

const coreFilterNamesInDrawer: readonly string[] = ['status', 'platform', 'criticality'];

const applyButtonClass =
  'inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] dark:focus-visible:ring-offset-slate-950';

function countSelections(filters: Filters): number {
  return (Object.keys(filters) as (keyof Filters)[])
    .filter((name) => name !== 'q')
    .reduce((total, name) => total + filters[name].length, 0);
}

/** Zeroes every filter except the free-text query, which the card owns. */
function clearFacets(current: Filters): Filters {
  const cleared = { ...current };
  (Object.keys(cleared) as (keyof Filters)[]).forEach((name) => {
    if (name !== 'q') cleared[name] = [];
  });
  return cleared;
}

export function FilterDrawer({
  open,
  filters,
  onClose,
  onApply,
}: {
  open: boolean;
  filters: Filters;
  onClose: () => void;
  onApply: (filters: Filters) => void;
}) {
  // Staged copy: edits live here until Apply. Re-seeded whenever the drawer is
  // opened or the applied filters change underneath it (e.g. a chip dismissed
  // in the card while the drawer was closed).
  const [staged, setStaged] = useState<Filters>(filters);

  useEffect(() => {
    if (open) setStaged(filters);
  }, [open, filters]);

  // Fleet-derived facets — fetched once and reused across every open.
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: dynamicFetchers.owner, staleTime: 60_000 });
  const clustersQuery = useQuery({ queryKey: ['vm-clusters'], queryFn: dynamicFetchers.cluster, staleTime: 60_000 });
  const nodesQuery = useQuery({ queryKey: ['vm-nodes'], queryFn: dynamicFetchers.node, staleTime: 60_000 });
  const tagsQuery = useQuery({ queryKey: ['vm-tags'], queryFn: dynamicFetchers.tag, staleTime: 60_000 });
  const applicationsQuery = useQuery({ queryKey: ['vm-applications'], queryFn: dynamicFetchers.application, staleTime: 60_000 });

  const dynamicResults: Record<DynamicFilterName, { options: string[]; isLoading: boolean; isError: boolean }> = {
    owner: { options: ownersQuery.data ?? [], isLoading: ownersQuery.isLoading, isError: ownersQuery.isError },
    cluster: { options: clustersQuery.data ?? [], isLoading: clustersQuery.isLoading, isError: clustersQuery.isError },
    node: { options: nodesQuery.data ?? [], isLoading: nodesQuery.isLoading, isError: nodesQuery.isError },
    tag: { options: tagsQuery.data ?? [], isLoading: tagsQuery.isLoading, isError: tagsQuery.isError },
    application: { options: applicationsQuery.data ?? [], isLoading: applicationsQuery.isLoading, isError: applicationsQuery.isError },
  };

  function setField(name: AdvancedFilterName, values: string[]) {
    setStaged((prev) => ({ ...prev, [name]: values }));
  }

  function handleApply() {
    onApply({ ...staged, q: filters.q });
    onClose();
  }

  function handleCancel() {
    setStaged(filters);
    onClose();
  }

  function renderField(name: AdvancedFilterName) {
    const config = advancedFilterConfig[name];
    const label = advancedFilterLabels[name];
    const values = staged[name] ?? [];

    if (coreFilterNamesInDrawer.includes(name) && config.kind === 'multiSelect') {
      return (
        <div key={name} className="space-y-2">
          <span className={labelClass}>{label}</span>
          <SegmentedControl
            label={label}
            value={values}
            options={config.options}
            type={coreFilterTypes[name as CoreFilterName]}
            labels={config.labels}
            onChange={(v) => setField(name, v)}
          />
        </div>
      );
    }

    if (config.kind === 'dynamicMultiSelect') {
      const dynamic = dynamicResults[name as DynamicFilterName];
      if (dynamic.isLoading) {
        return (
          <div key={name} className="space-y-2">
            <span className={labelClass}>{label}</span>
            <div
              className="h-9 w-full animate-pulse rounded-lg bg-[var(--color-surface-tertiary)] dark:bg-slate-800"
              aria-label={`Loading ${label} options`}
            />
          </div>
        );
      }
      if (dynamic.isError) {
        return (
          <div key={name} className="space-y-2">
            <span className={labelClass}>{label}</span>
            <p className="text-sm text-[var(--color-criticality-critical)]">
              Couldn&apos;t load {label.toLowerCase()} options.
            </p>
          </div>
        );
      }
      if (dynamic.options.length === 0) {
        return (
          <div key={name} className="space-y-2">
            <span className={labelClass}>{label}</span>
            <p className="text-sm text-[var(--color-text-tertiary)] dark:text-slate-400">
              No {label.toLowerCase()} values in the fleet yet.
            </p>
          </div>
        );
      }
      return (
        <div key={name} className="space-y-2">
          <span className={labelClass}>{label}</span>
          <FuzzyMultiSelect
            value={values}
            options={dynamic.options}
            onChange={(v) => setField(name, v)}
            placeholder={label}
            labels={config.labels}
          />
        </div>
      );
    }

    return (
      <div key={name} className="space-y-2">
        <span className={labelClass}>{label}</span>
        <FuzzyMultiSelect
          value={values}
          options={[...config.options]}
          onChange={(v) => setField(name, v)}
          placeholder={label}
          labels={config.labels}
        />
      </div>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={handleCancel}
      title="Filters"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button
            type="button"
            className={cn(secondaryButtonClass, 'text-xs')}
            onClick={() => setStaged(clearFacets(staged))}
          >
            Clear all
          </button>
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" className={applyButtonClass} onClick={handleApply}>
              Apply ({countSelections(staged)})
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {filterGroups.map((group) => (
          <fieldset key={group.label} className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)] dark:text-slate-400">
              {group.label}
            </legend>
            {group.filters.map(renderField)}
          </fieldset>
        ))}
      </div>
    </Drawer>
  );
}
