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
  const hasChanges = Object.keys(patch).length > 0;

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
      <p className="mb-4 text-sm text-[var(--color-text-secondary)] dark:text-slate-400">
        Every field starts unchanged. Only fields you set are written.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
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

        {TEXT_FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className={labelClass}>{field.label}</span>
            <input
              className={inputClass}
              aria-label={field.label}
              value={values[field.key] ?? ''}
              onChange={(event) => set(field.key, event.target.value)}
            />
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Add tags</span>
          <input className={inputClass} aria-label="Add tags" placeholder="comma separated" value={tagsAdd} onChange={(event) => setTagsAdd(event.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>Remove tags</span>
          <input className={inputClass} aria-label="Remove tags" placeholder="comma separated" value={tagsRemove} onChange={(event) => setTagsRemove(event.target.value)} />
        </label>
      </div>

      <p className="mt-4 text-sm text-[var(--color-text-tertiary)] dark:text-slate-500">
        Setting VM type to temporary on a VM with a decommission date also moves its
        lifecycle to retiring, exactly as the VM form does.
      </p>
    </Drawer>
  );
}
