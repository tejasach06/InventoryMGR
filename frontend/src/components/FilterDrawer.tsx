import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Drawer, inputClass, labelClass } from './ui';
import { FuzzyMultiSelect } from './FuzzyMultiSelect';

export type AdvancedFilters = {
  status: string[];
  platform: string[];
  criticality: string[];
  cluster: string[];
  lifecycle: string[];
  environment: string[];
  monitoring_enabled: string[];
  node: string[];
  os_family: string[];
  owner: string[];
  pmp_enabled: string[];
  tag: string[];
  application: string[];
  health: string[];
};

type AdvancedFilterName = keyof AdvancedFilters;

type AdvancedFieldConfig =
  | { kind: 'multiSelect'; options: readonly string[]; labels?: Record<string, string> }
  | { kind: 'dynamicMultiSelect' }
  | { kind: 'input'; placeholder: string };

// Group order defines drawer layout — primary attributes first, then operational, then metadata.
const filterGroups: { label: string; filters: AdvancedFilterName[] }[] = [
  {
    label: 'Classification',
    filters: ['status', 'platform', 'criticality', 'lifecycle', 'environment'],
  },
  {
    label: 'Infrastructure',
    filters: ['cluster', 'node', 'os_family'],
  },
  {
    label: 'Ownership',
    filters: ['owner'],
  },
  {
    label: 'Services',
    filters: ['application', 'tag'],
  },
  {
    label: 'Operations',
    filters: ['monitoring_enabled', 'pmp_enabled', 'health'],
  },
];

const advancedFilterConfig: Record<AdvancedFilterName, AdvancedFieldConfig> = {
  status: {
    kind: 'multiSelect',
    options: ['running', 'powered_off', 'suspended', 'archived', 'decommissioned', 'unknown'],
    labels: { running: 'Running', powered_off: 'Powered Off', suspended: 'Suspended', archived: 'Archived', decommissioned: 'Decommissioned', unknown: 'Unknown' },
  },
  platform: { kind: 'multiSelect', options: ['proxmox', 'vmware'] },
  criticality: {
    kind: 'multiSelect',
    options: ['low', 'medium', 'high', 'critical'],
    labels: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
  },
  lifecycle: {
    kind: 'multiSelect',
    options: ['planned', 'active', 'retiring', 'retired'],
    labels: { planned: 'Planned', active: 'Active', retiring: 'Retiring', retired: 'Retired' },
  },
  environment: {
    kind: 'multiSelect',
    options: ['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'],
  },
  monitoring_enabled: { kind: 'multiSelect', options: ['true', 'false'], labels: { true: 'Enabled', false: 'Disabled' } },
  os_family: { kind: 'multiSelect', options: ['linux', 'windows'] },
  owner: { kind: 'dynamicMultiSelect' },
  pmp_enabled: { kind: 'multiSelect', options: ['true', 'false'], labels: { true: 'Enabled', false: 'Disabled' } },
  health: {
    kind: 'multiSelect',
    options: ['below_50', 'below_75', 'complete'],
    labels: { below_50: '< 50%', below_75: '< 75%', complete: 'Complete (100%)' },
  },
  cluster: { kind: 'dynamicMultiSelect' },
  node: { kind: 'dynamicMultiSelect' },
  tag: { kind: 'dynamicMultiSelect' },
  application: { kind: 'dynamicMultiSelect' },
};

const advancedFilterLabels: Record<AdvancedFilterName, string> = {
  status: 'Status', platform: 'Platform', criticality: 'Criticality',
  lifecycle: 'Lifecycle', environment: 'Environment',
  monitoring_enabled: 'Monitoring', node: 'Node', os_family: 'OS Family',
  owner: 'Owner', pmp_enabled: 'PMP Access', cluster: 'Cluster',
  tag: 'Tag', application: 'Application', health: 'Doc Health',
};

function FilterGroup({
  name,
  config,
  values,
  onToggle,
  onSetInput,
  onSetValues,
  dynamicOptions,
}: {
  name: AdvancedFilterName;
  config: AdvancedFieldConfig;
  values: string[];
  onToggle: (value: string) => void;
  onSetInput: (value: string) => void;
  onSetValues: (values: string[]) => void;
  dynamicOptions?: string[];
}) {
  return (
    <div>
      <label className={labelClass}>{advancedFilterLabels[name]}</label>
      {config.kind === 'dynamicMultiSelect' ? (
        <FuzzyMultiSelect
          value={values}
          options={dynamicOptions ?? []}
          onChange={onSetValues}
          placeholder={`Filter ${advancedFilterLabels[name].toLowerCase()}...`}
        />
      ) : config.kind === 'input' ? (
        <input
          className={inputClass}
          value={values[0] ?? ''}
          placeholder={config.placeholder}
          onChange={(e) => onSetInput(e.target.value)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {(config.kind === 'multiSelect' ? config.options : []).map((value) => {
            const selected = values.includes(value);
            const displayLabel = config.kind === 'multiSelect' && config.labels ? (config.labels[value] ?? value) : value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onToggle(value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {displayLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FilterDrawer({
  open,
  onClose,
  filters,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: AdvancedFilters;
  onApply: (filters: AdvancedFilters) => void;
}) {
  const [draft, setDraft] = useState<AdvancedFilters>(filters);
  const owners = useQuery({ queryKey: ['vm-owners'], queryFn: () => api.listVmOwners(), staleTime: 60_000 });
  const clusters = useQuery({ queryKey: ['vm-clusters'], queryFn: () => api.listVmClusters(), staleTime: 60_000 });
  const nodes = useQuery({ queryKey: ['vm-nodes'], queryFn: () => api.listVmNodes(), staleTime: 60_000 });
  const tags = useQuery({ queryKey: ['vm-tags'], queryFn: () => api.listVmTags(), staleTime: 60_000 });
  const applications = useQuery({ queryKey: ['vm-apps'], queryFn: () => api.listVmApplications(), staleTime: 60_000 });

  function toggleValue(name: AdvancedFilterName, value: string) {
    setDraft((prev) => {
      const current = prev[name];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [name]: next };
    });
  }

  function setInputValue(name: AdvancedFilterName, value: string) {
    setDraft((prev) => ({ ...prev, [name]: value ? [value] : [] }));
  }

  function setValues(name: AdvancedFilterName, values: string[]) {
    setDraft((prev) => ({ ...prev, [name]: values }));
  }

  function handleReset() {
    const empty = {} as AdvancedFilters;
    for (const key of Object.keys(draft) as AdvancedFilterName[]) {
      (empty as Record<string, string[]>)[key] = [];
    }
    setDraft(empty);
  }

  function handleApply() {
    onApply(draft);
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Filters">
      <div className="space-y-6">
        {filterGroups.map((group) => (
          <div key={group.label}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.label}
            </h4>
            <div className="space-y-4">
              {group.filters.map((name) => {
                const config = advancedFilterConfig[name];
                return (
                  <FilterGroup
                    key={name}
                    name={name}
                    config={config}
                    values={draft[name]}
                    onToggle={(v) => toggleValue(name, v)}
                    onSetInput={(v) => setInputValue(name, v)}
                    onSetValues={(v) => setValues(name, v)}
                    dynamicOptions={
                      name === 'owner' ? owners.data :
                      name === 'cluster' ? clusters.data :
                      name === 'node' ? nodes.data :
                      name === 'tag' ? tags.data :
                      name === 'application' ? applications.data : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <button onClick={handleApply} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
            Apply Filters
          </button>
          <button onClick={handleReset} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Reset
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}
