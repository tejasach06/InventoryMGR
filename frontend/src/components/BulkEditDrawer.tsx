'use client';

import { useState } from 'react';
import { Alert, Drawer, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass } from './ui';

export type BulkPatch = Record<string, string | boolean | string[]>;

const UNCHANGED = '';

const SELECT_FIELDS = [
  { key: 'status', label: 'Status', options: ['running', 'powered_off', 'suspended', 'archived', 'decommissioned', 'unknown'] },
  { key: 'environment', label: 'Environment', options: ['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'] },
  { key: 'criticality', label: 'Criticality', options: ['critical', 'high', 'medium', 'low'] },
  { key: 'lifecycle', label: 'Lifecycle', options: ['planned', 'active', 'retiring', 'retired'] },
  { key: 'vm_type', label: 'VM type', options: ['permanent', 'temporary'] },
] as const;

const TEXT_FIELDS = [
  { key: 'cluster', label: 'Cluster' },
  { key: 'node', label: 'Node' },
  { key: 'datacenter', label: 'Datacenter' },
  { key: 'owner', label: 'Owner' },
  { key: 'business_owner', label: 'Business owner' },
  { key: 'technical_owner', label: 'Technical owner' },
  { key: 'backup_location', label: 'Backup location' },
] as const;

const FLAG_FIELDS = [
  { key: 'pmp_enabled', label: 'PMP' },
  { key: 'monitoring_enabled', label: 'Monitoring' },
  { key: 'backup_enabled', label: 'Backup' },
  { key: 'ha_enabled', label: 'HA' },
] as const;

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function BulkEditDrawer({
  open,
  onClose,
  targetLabel,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  targetLabel: string;
  onSubmit: (patch: BulkPatch) => void;
  pending: boolean;
  error?: string;
}) {
  const [activeTab, setActiveTab] = useState<'state' | 'infra' | 'ops' | 'tags'>('state');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tagsAdd, setTagsAdd] = useState('');
  const [tagsRemove, setTagsRemove] = useState('');

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const patch: BulkPatch = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === UNCHANGED) continue;
    const flag = FLAG_FIELDS.find((field) => field.key === key);
    patch[key] = flag ? value === 'true' : value;
  }
  if (splitTags(tagsAdd).length > 0) patch.tags_add = splitTags(tagsAdd);
  if (splitTags(tagsRemove).length > 0) patch.tags_remove = splitTags(tagsRemove);
  const stagedKeys = Object.keys(patch);
  const hasChanges = stagedKeys.length > 0;

  // Track staged fields per tab for visual badges
  const stateStaged = SELECT_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED);
  const infraStaged = TEXT_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED);
  const opsStaged = FLAG_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED) || (values.last_verified_at && values.last_verified_at !== UNCHANGED);
  const tagsStaged = Boolean(splitTags(tagsAdd).length > 0 || splitTags(tagsRemove).length > 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${targetLabel}`}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={!hasChanges || pending}
            onClick={() => onSubmit(patch)}
          >
            Apply to {targetLabel}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      
      {/* Sticky staged modification summary */}
      <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/60">
        <span className="text-[var(--color-text-secondary)] dark:text-slate-400">
          Every field starts unchanged. Only modified fields are written.
        </span>
        {hasChanges ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2.5 py-0.5 font-semibold text-[var(--color-accent)] dark:text-orange-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            {stagedKeys.length} staged
          </span>
        ) : (
          <span className="text-[var(--color-text-tertiary)] dark:text-slate-500">0 staged</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex border-b border-[var(--color-border)] text-xs font-semibold dark:border-slate-800" role="tablist">
        {[
          { id: 'state', label: 'Core State', staged: stateStaged },
          { id: 'infra', label: 'Infrastructure', staged: infraStaged },
          { id: 'ops', label: 'Operations', staged: opsStaged },
          { id: 'tags', label: 'Tags', staged: tagsStaged },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`relative flex-1 pb-2.5 text-center transition-colors focus-visible:outline-none ${
                active
                  ? 'text-[var(--color-accent)] dark:text-orange-400 font-bold border-b-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] dark:hover:text-slate-300'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {tab.label}
                {tab.staged && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />}
              </span>
            </button>
          );
        })}
      </div>
      <div>
        {/* Tab 1: State & Lifecycle */}
        <div className={activeTab === 'state' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4 dark:border-slate-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] dark:text-orange-400">
              Core State & Lifecycle
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {SELECT_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className={labelClass}>{field.label}</span>
                  <select
                    className={selectClass}
                    aria-label={field.label}
                    value={values[field.key] ?? UNCHANGED}
                    onChange={(event) => set(field.key, event.target.value)}
                  >
                    <option value={UNCHANGED}>Leave unchanged</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Tab 2: Infrastructure & Ownership */}
        <div className={activeTab === 'infra' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4 dark:border-slate-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] dark:text-orange-400">
              Infrastructure & Ownership
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className={labelClass}>{field.label}</span>
                  <input
                    className={inputClass}
                    aria-label={field.label}
                    maxLength={255}
                    value={values[field.key] ?? ''}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Tab 3: Operational Flags & Verification */}
        <div className={activeTab === 'ops' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4 dark:border-slate-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] dark:text-orange-400">
              Operational Flags & Verification
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {FLAG_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className={labelClass}>{field.label}</span>
                  <select
                    className={selectClass}
                    aria-label={field.label}
                    value={values[field.key] ?? UNCHANGED}
                    onChange={(event) => set(field.key, event.target.value)}
                  >
                    <option value={UNCHANGED}>Leave unchanged</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </label>
              ))}
              <label className="block">
                <span className={labelClass}>Last verified</span>
                <input
                  type="date"
                  className={inputClass}
                  aria-label="Last verified"
                  value={values.last_verified_at ?? ''}
                  onChange={(event) => set('last_verified_at', event.target.value)}
                />
              </label>
            </div>
          </fieldset>
        </div>

        {/* Tab 4: Tag Management */}
        <div className={activeTab === 'tags' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4 dark:border-slate-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] dark:text-orange-400">
              Tag Management
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Add tags</span>
                <input className={inputClass} aria-label="Add tags" maxLength={500} placeholder="comma separated" value={tagsAdd} onChange={(event) => setTagsAdd(event.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Remove tags</span>
                <input className={inputClass} aria-label="Remove tags" maxLength={500} placeholder="comma separated" value={tagsRemove} onChange={(event) => setTagsRemove(event.target.value)} />
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--color-text-tertiary)] dark:text-slate-500">
        Setting VM type to temporary on a VM with a decommission date also moves its
        lifecycle to retiring, exactly as the VM form does.
      </p>
    </Drawer>
  );
}
