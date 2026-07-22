'use client';

import { useState } from 'react';
import type { ArrayPayload, StorageVendor } from '../api/client';
import {
  Spinner, inputClass, selectClass, textareaClass, labelClass,
  primaryButtonClass, secondaryButtonClass,
} from './ui';

const VENDORS: StorageVendor[] = ['synology', 'netapp'];

export interface ArrayFormValues {
  name: string;
  vendor: StorageVendor | '';
  model: string;
  mgmt_host: string;
  datacenter: string;
  total_capacity_gb: string;
  used_capacity_gb: string;
  description: string;
  notes: string;
}

const EMPTY: ArrayFormValues = {
  name: '', vendor: '', model: '', mgmt_host: '', datacenter: '',
  total_capacity_gb: '', used_capacity_gb: '', description: '', notes: '',
};

function toPayload(v: ArrayFormValues): ArrayPayload {
  return {
    name: v.name.trim(),
    vendor: v.vendor as StorageVendor,
    model: v.model.trim() || null,
    mgmt_host: v.mgmt_host.trim() || null,
    datacenter: v.datacenter.trim() || null,
    total_capacity_gb: Number(v.total_capacity_gb) || 0,
    used_capacity_gb: Number(v.used_capacity_gb) || 0,
    description: v.description.trim() || null,
    notes: v.notes.trim() || null,
  };
}

export function ArrayForm({ initial, onSubmit, onCancel, pending, submitLabel }: {
  initial?: Partial<ArrayFormValues>;
  onSubmit: (payload: ArrayPayload) => void;
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [v, setV] = useState<ArrayFormValues>({ ...EMPTY, ...initial });
  const set = (k: keyof ArrayFormValues) => (e: { target: { value: string } }) =>
    setV((c) => ({ ...c, [k]: e.target.value }));
  const valid = v.name.trim() !== '' && v.vendor !== '';

  const field = (k: keyof ArrayFormValues, label: string, type = 'text') => (
    <label className="grid gap-1">
      <span className={labelClass}>{label}</span>
      <input type={type} aria-label={label} value={v[k]} onChange={set(k)} className={inputClass} />
    </label>
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'Name')}
        <label className="grid gap-1">
          <span className={labelClass}>Vendor</span>
          <select aria-label="Vendor" value={v.vendor} onChange={set('vendor')} className={selectClass}>
            <option value="">Select vendor…</option>
            {VENDORS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        {field('model', 'Model')}
        {field('mgmt_host', 'Management host')}
        {field('datacenter', 'Datacenter')}
        {field('total_capacity_gb', 'Total capacity (GB)', 'number')}
        {field('used_capacity_gb', 'Used capacity (GB)', 'number')}
      </div>
      <label className="grid gap-1">
        <span className={labelClass}>Description</span>
        <textarea aria-label="Description" value={v.description} onChange={set('description')} className={textareaClass} />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>Notes</span>
        <textarea aria-label="Notes" value={v.notes} onChange={set('notes')} className={textareaClass} />
      </label>
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={!valid || pending}
          onClick={() => onSubmit(toPayload(v))}>
          {pending ? <Spinner /> : null}{submitLabel}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
