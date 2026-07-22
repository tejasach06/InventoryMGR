# Storage Array Create + Edit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors/admins create a storage array from the list page and edit an array's own fields from the detail page, wiring the already-existing `createArray`/`updateArray` API client methods to UI.

**Architecture:** One shared controlled `ArrayForm` component (all `ArrayPayload` fields, name+vendor required). The list page mounts it blank behind a `+ New array` toggle; the detail page mounts it prefilled behind an `Edit` toggle on the Capacity card. Both use react-query mutations that invalidate the relevant query keys. No backend, migration, or `client.ts` change.

**Tech Stack:** React 18, Next.js app router, @tanstack/react-query, TypeScript strict, Vitest + @testing-library/react.

## Global Constraints

- Vitest coverage must stay ≥80% on lines/statements/functions/branches.
- All HTTP goes through `src/api/client.ts` — never call `fetch` from a component.
- RBAC: `canEdit = user.role === 'editor' || user.role === 'admin'`. Viewers see no mutation controls.
- Reuse existing styling exports from `src/components/ui.tsx`: `inputClass`, `selectClass`, `textareaClass`, `labelClass`, `primaryButtonClass`, `secondaryButtonClass`, `Spinner`.
- `ArrayPayload` type (already in `client.ts`): `Partial<Omit<StorageArray, id|used_pct|over_threshold|volumes|created_at|updated_at>> & { name: string; vendor: StorageVendor }`. `StorageVendor = 'synology' | 'netapp'`.

## File Structure

- Create: `frontend/src/components/ArrayForm.tsx` — shared create/edit form, one responsibility (collect array fields → `ArrayPayload`).
- Modify: `frontend/src/routes/StoragePage.tsx` — add `+ New array` toggle + create mutation.
- Modify: `frontend/src/routes/StorageDetailPage.tsx` — add `Edit` toggle on Capacity card + update mutation.
- Test: `frontend/src/test/StoragePage.test.tsx`, `frontend/src/test/StorageDetailPage.test.tsx` (extend existing).

---

### Task 1: Shared `ArrayForm` + create-array on the list page

**Files:**
- Create: `frontend/src/components/ArrayForm.tsx`
- Modify: `frontend/src/routes/StoragePage.tsx`
- Test: `frontend/src/test/StoragePage.test.tsx`

**Interfaces:**
- Consumes: `api.createArray(payload: ArrayPayload) => Promise<StorageArray>`, `ArrayPayload`, `StorageVendor` from `../api/client`; `useCurrentUser` from `../components/AuthContext`.
- Produces: `ArrayForm` component with props
  `{ initial?: Partial<ArrayFormValues>; onSubmit: (payload: ArrayPayload) => void; onCancel: () => void; pending: boolean; submitLabel: string }`.
  Later tasks reuse `ArrayForm` and `ArrayFormValues`.

- [ ] **Step 1: Write the failing test** — add to `frontend/src/test/StoragePage.test.tsx`

Update the imports at the top of the file to pull in `makeUser`, `fireEvent`, `waitFor`, `beforeEach`, and the `StorageArray` type, and add the navigation mock:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { StorageArray, StorageArrayListItem } from '../api/client';
import { StoragePage } from '../routes/StoragePage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hoisted.pushMock }) }));

beforeEach(() => { hoisted.pushMock.mockReset(); });
```

Add these two tests inside the `describe('StoragePage', ...)` block:

```tsx
  it('hides the New array button for viewers', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    renderWithProviders(<StoragePage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByText('No storage arrays yet.');
    expect(screen.queryByRole('button', { name: /new array/i })).not.toBeInTheDocument();
  });

  it('creates an array and navigates to its detail page (editor)', async () => {
    vi.spyOn(api, 'listArrays').mockResolvedValue([]);
    const created: StorageArray = {
      id: 'a9', name: 'syn-09', vendor: 'synology', model: null, mgmt_host: null,
      datacenter: null, description: null, total_capacity_gb: 500, used_capacity_gb: 0,
      notes: null, used_pct: 0, over_threshold: false,
      created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z', volumes: [],
    };
    const createSpy = vi.spyOn(api, 'createArray').mockResolvedValue(created);
    renderWithProviders(<StoragePage />, { user: makeUser({ role: 'editor' }) });

    fireEvent.click(await screen.findByRole('button', { name: /new array/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'syn-09' } });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'synology' } });
    fireEvent.change(screen.getByLabelText('Total capacity (GB)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /^create array$/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'syn-09', vendor: 'synology', total_capacity_gb: 500 }),
      );
      expect(hoisted.pushMock).toHaveBeenCalledWith('/storage/a9');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/test/StoragePage.test.tsx`
Expected: FAIL — no `New array` button / `ArrayForm` not found.

- [ ] **Step 3: Create `frontend/src/components/ArrayForm.tsx`**

```tsx
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
```

- [ ] **Step 4: Wire the create form into `frontend/src/routes/StoragePage.tsx`**

Change the top imports to (adds `useState`, `useRouter`, mutation hooks, `ArrayPayload`, `primaryButtonClass`, `useCurrentUser`, `ArrayForm`):

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ArrayPayload, StorageArrayListItem } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton, primaryButtonClass, cardClass, tableWrapClass, tableClass, tableHeadClass, tableBodyClass, tableRowClass, tableCellClass } from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ArrayForm } from '../components/ArrayForm';
```

Replace from `export function StoragePage() {` through the `{arraysQ.isError ? <Alert>...</Alert> : null}` line with:

```tsx
export function StoragePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const [showForm, setShowForm] = useState(false);

  const arraysQ = useQuery({ queryKey: ['arrays'], queryFn: () => api.listArrays() });
  const arrays: StorageArrayListItem[] = arraysQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: ArrayPayload) => api.createArray(payload),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['arrays'] });
      setShowForm(false);
      router.push(`/storage/${created.id}`);
    },
  });

  return (
    <PageTransition>
      <PageHeader title="Storage" eyebrow="Infrastructure" actions={
        canEdit && !showForm ? (
          <button className={primaryButtonClass} onClick={() => setShowForm(true)}>+ New array</button>
        ) : null
      } />

      {canEdit && showForm ? (
        <div className={`${cardClass} mb-6`}>
          <ArrayForm
            onSubmit={(payload) => createMut.mutate(payload)}
            onCancel={() => setShowForm(false)}
            pending={createMut.isPending}
            submitLabel="Create array"
          />
          {createMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(createMut.error)}</p> : null}
        </div>
      ) : null}

      {arraysQ.isError ? <Alert>{detailMessage(arraysQ.error)}</Alert> : null}
```

Leave the rest of the render (loading skeleton, empty state, table) exactly as-is. The old `UsageBar` and `ThresholdBadge` helpers above the component stay unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/test/StoragePage.test.tsx`
Expected: PASS (all StoragePage tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ArrayForm.tsx frontend/src/routes/StoragePage.tsx frontend/src/test/StoragePage.test.tsx
git commit -m "feat(web): create storage array from list page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Edit-array on the detail page

**Files:**
- Modify: `frontend/src/routes/StorageDetailPage.tsx`
- Test: `frontend/src/test/StorageDetailPage.test.tsx`

**Interfaces:**
- Consumes: `ArrayForm` + `ArrayFormValues` from `../components/ArrayForm` (Task 1); `api.updateArray(id, Partial<ArrayPayload>) => Promise<StorageArray>`.
- Produces: nothing new; final task.

- [ ] **Step 1: Write the failing test** — add to `frontend/src/test/StorageDetailPage.test.tsx`

Add inside `describe('StorageDetailPage', ...)`:

```tsx
  it('edits the array and calls api.updateArray (editor)', async () => {
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: ['pve-a'], os: [], os_by_family: { linux: [], windows: [] },
    });
    const updateSpy = vi.spyOn(api, 'updateArray').mockResolvedValue({ ...makeArray(), name: 'syn-renamed' });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'editor' }) });

    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'syn-renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('a1', expect.objectContaining({ name: 'syn-renamed' })));
  });

  it('cancels editing and hides the Edit button for viewers', async () => {
    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: ['pve-a'], os: [], os_by_family: { linux: [], windows: [] },
    });
    const { unmount } = renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'editor' }) });
    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(await screen.findByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    unmount();

    vi.spyOn(api, 'getArray').mockResolvedValue(makeArray());
    vi.spyOn(api, 'getDropdownOptions').mockResolvedValue({
      cpu: [], datacenter: [], disk: [], cluster: [], os: [], os_by_family: { linux: [], windows: [] },
    });
    renderWithProviders(<StorageDetailPage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByRole('heading', { name: 'syn-01' });
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/test/StorageDetailPage.test.tsx`
Expected: FAIL — no `Edit` button.

- [ ] **Step 3: Wire the edit form into `frontend/src/routes/StorageDetailPage.tsx`**

Add to the imports at the top of the file (`useState` is already imported from `react`):

```tsx
import { ArrayForm } from '../components/ArrayForm';
import type { ArrayFormValues } from '../components/ArrayForm';
```

Extend the existing `../api/client` import to also bring in `ArrayPayload`, and the existing `../components/ui` import to also bring in `primaryButtonClass`.

Inside `StorageDetailPage`, after the `deleteMut` declaration, add editing state + mutation:

```tsx
  const [editing, setEditing] = useState(false);
  const updateMut = useMutation({
    mutationFn: (payload: ArrayPayload) => api.updateArray(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['array', id] });
      qc.invalidateQueries({ queryKey: ['arrays'] });
      setEditing(false);
    },
  });
```

Replace the Capacity `<section>` (the block containing `<h2 className={sectionTitleClass}>Capacity</h2>`) with:

```tsx
        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
          <div className="flex items-center justify-between">
            <h2 className={sectionTitleClass}>Capacity</h2>
            {canEdit && !editing ? (
              <button className={primaryButtonClass} onClick={() => setEditing(true)}>Edit</button>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-4">
              <ArrayForm
                initial={{
                  name: array.name,
                  vendor: array.vendor,
                  model: array.model ?? '',
                  mgmt_host: array.mgmt_host ?? '',
                  datacenter: array.datacenter ?? '',
                  total_capacity_gb: String(array.total_capacity_gb),
                  used_capacity_gb: String(array.used_capacity_gb),
                  description: array.description ?? '',
                  notes: array.notes ?? '',
                } as Partial<ArrayFormValues>}
                onSubmit={(payload) => updateMut.mutate(payload)}
                onCancel={() => setEditing(false)}
                pending={updateMut.isPending}
                submitLabel="Save changes"
              />
              {updateMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(updateMut.error)}</p> : null}
            </div>
          ) : (
            <div className="mt-3">
              <UsageBar pct={array.used_pct} over={array.over_threshold} />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {array.used_capacity_gb} / {array.total_capacity_gb} GB
                {array.datacenter ? ` · ${array.datacenter}` : ''}
                {array.model ? ` · ${array.model}` : ''}
              </p>
            </div>
          )}
        </section>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/test/StorageDetailPage.test.tsx`
Expected: PASS (all StorageDetailPage tests).

- [ ] **Step 5: Full frontend gate (types + coverage)**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: type-check clean; all tests pass; coverage ≥80% on all four metrics. The Task 2 Step 1 cancel test already exercises the cancel branch; if coverage still dips, add an assertion filling a numeric field with an empty string to cover the `Number() || 0` fallback in `toPayload`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/StorageDetailPage.tsx frontend/src/test/StorageDetailPage.test.tsx
git commit -m "feat(web): edit storage array fields from detail page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** shared `ArrayForm` (Task 1 Step 3) ✓; create on list (Task 1) ✓; edit on detail (Task 2) ✓; RBAC gating tested on both pages ✓; tests keep coverage (Task 2 Step 5) ✓; no backend/client change ✓.
- **Type consistency:** `ArrayForm`/`ArrayFormValues` props identical in both tasks; `createArray`→`StorageArray` (`.id` used to navigate); `updateArray(id, ArrayPayload)` matches `client.ts` `Partial<ArrayPayload>` signature.
- **Placeholders:** none — full component + wiring + test code inline.
