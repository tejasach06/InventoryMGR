'use client';

import { useState } from 'react';
import { Alert, Drawer, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass } from './ui';
import { ComboInput } from './ComboInput';
import { TagInput } from './TagInput';
export type BulkPatch = Record<string, string | boolean | string[]>;

const UNCHANGED = '';

const SELECT_FIELDS = [
  { key: 'status', label: 'Status', options: ['running', 'powered_off', 'decommissioned', 'unknown'] },
  { key: 'environment', label: 'Environment', options: ['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'] },
  { key: 'criticality', label: 'Criticality', options: ['critical', 'high', 'medium', 'low'] },
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


export function BulkEditDrawer({
  open,
  onClose,
  targetLabel,
  onSubmit,
  pending,
  error,
  suggestions,
  tagOptions,
}: {
  open: boolean;
  onClose: () => void;
  targetLabel: string;
  onSubmit: (patch: BulkPatch) => void;
  pending: boolean;
  error?: string;
  suggestions: Record<string, string[]>;
  tagOptions: string[];
}) {
  const [activeTab, setActiveTab] = useState<'state' | 'infra' | 'ops' | 'tags'>('state');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tagsAdd, setTagsAdd] = useState<string[]>([]);
  const [tagsRemove, setTagsRemove] = useState<string[]>([]);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const patch: BulkPatch = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === UNCHANGED) continue;
    const flag = FLAG_FIELDS.find((field) => field.key === key);
    patch[key] = flag ? value === 'true' : value;
  }
  if (tagsAdd.length > 0) patch.tags_add = tagsAdd;
  if (tagsRemove.length > 0) patch.tags_remove = tagsRemove;
  const stagedKeys = Object.keys(patch);
  const hasChanges = stagedKeys.length > 0;

  // Track staged fields per tab for visual badges
  const stateStaged = SELECT_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED);
  const infraStaged = TEXT_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED);
  const opsStaged = FLAG_FIELDS.some((f) => values[f.key] && values[f.key] !== UNCHANGED) || (values.last_verified_at && values.last_verified_at !== UNCHANGED);
  const tagsStaged = tagsAdd.length > 0 || tagsRemove.length > 0;

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
      <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-xs">
        <span className="text-[var(--color-text-secondary)]">
          Every field starts unchanged. Only modified fields are written.
        </span>
        {hasChanges ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2.5 py-0.5 font-semibold text-[var(--color-accent-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            {stagedKeys.length} staged
          </span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">0 staged</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex border-b border-[var(--color-border)] text-xs font-semibold" role="tablist">
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
                  ? 'text-[var(--color-accent-text)] font-bold border-b-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
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
        {/* Tab 1: State */}
        <div className={activeTab === 'state' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-text)]">
              Core State
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
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-text)]">
              Infrastructure & Ownership
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <ComboInput
                  key={field.key}
                  id={`bulk-${field.key}`}
                  label={field.label}
                  value={values[field.key] ?? ''}
                  options={suggestions[field.key] ?? []}
                  onChange={(next) => set(field.key, next)}
                />
              ))}
            </div>
          </fieldset>
        </div>

        {/* Tab 3: Operational Flags & Verification */}
        <div className={activeTab === 'ops' ? 'block' : 'hidden'}>
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-text)]">
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
          <fieldset className="rounded-xl border border-[var(--color-border)] p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-text)]">
              Tag Management
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="bulk-tags-add">Add tags</label>
                <TagInput id="bulk-tags-add" value={tagsAdd} options={tagOptions} onChange={setTagsAdd} />
              </div>
              <div>
                <label className={labelClass} htmlFor="bulk-tags-remove">Remove tags</label>
                <TagInput id="bulk-tags-remove" value={tagsRemove} options={tagOptions} onChange={setTagsRemove} />
              </div>
            </div>
          </fieldset>
        </div>
      </div>

    </Drawer>
  );
}
