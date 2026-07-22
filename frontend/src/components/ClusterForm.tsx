'use client';

import { useState } from 'react';
import type { ClusterPayload } from '../api/client';
import { Spinner, inputClass, textareaClass, labelClass, primaryButtonClass, secondaryButtonClass } from './ui';

export interface ClusterFormValues {
  name: string;
  description: string;
  notes: string;
}

const EMPTY: ClusterFormValues = { name: '', description: '', notes: '' };

function toPayload(v: ClusterFormValues): ClusterPayload {
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    notes: v.notes.trim() || null,
  };
}

export function ClusterForm({ initial, onSubmit, onCancel, pending, submitLabel }: {
  initial?: Partial<ClusterFormValues>;
  onSubmit: (payload: ClusterPayload) => void;
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [v, setV] = useState<ClusterFormValues>({ ...EMPTY, ...initial });
  const set = (k: keyof ClusterFormValues) => (e: { target: { value: string } }) =>
    setV((c) => ({ ...c, [k]: e.target.value }));
  const valid = v.name.trim() !== '';

  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className={labelClass}>Name</span>
        <input type="text" aria-label="Name" value={v.name} onChange={set('name')} className={inputClass} />
      </label>
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