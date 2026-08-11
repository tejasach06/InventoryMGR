# Inventory Page Structural Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the bounded REF-003 Inventory page structural refactor without changing any visible behavior, URL/search-parameter behavior, frontend API contract, query semantics, bulk workflow, or accessibility behavior.

**Architecture:** Treat the post-merge `frontend/src/routes/InventoryPage.tsx` implementation as the behavioral authority. First add route-level characterization coverage, then consolidate its duplicated URL/filter helpers into the already-present `frontend/src/lib/inventoryFilters.ts`, and finally make the already-present `VmTable` and `VmCard` components exact extractions of the currently rendered inline implementations. `InventoryPage` remains the orchestration owner for TanStack Query, mutations, URL synchronization, pagination, selection, bulk editing, alerts, and page composition; this plan does not extract hooks or redesign any surface.

**Tech Stack:** Next.js App Router, React 18, TypeScript 6, TanStack Query 5, Vitest, React Testing Library, Playwright, Bun, Devbox.

## Global Constraints

- Work from the current merged `dev` tree; inspect the files again immediately before each edit and do not use stale line counts.
- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Preserve `/inventory` and `/inventory/[id]` links plus the exact URL-driven search, repeated-filter, sorting, direction, pagination, and page-size semantics.
- Preserve `vmsApi.listVms`, `vmsApi.updateVm`, `vmsApi.bulkUpdateVms`, `vmsApi.exportVmsUrl`, and `vmsApi.exportSelectedUrl` calls and payload/query shapes; do not modify `frontend/src/api/vms.ts` or `frontend/src/api/types.ts`.
- Preserve page-local selection, select-all-matching, bulk confirmation, failed-item reselection, inline editing, export, empty/loading/error states, role gating, semantic badges, responsive table/card rendering, accessible names, `scope`, `aria-sort`, `aria-live`, focus behavior, and keyboard behavior.
- No redesign, new feature, cosmetic restyling, dependency change, backend change, API change, route change, schema change, database change, or unrelated formatting churn.
- Do not activate behavioral differences currently present in the unused extracted components; the inline implementations in `InventoryPage.tsx` are authoritative at the start of this plan.
- Run every project command through Devbox.
- `frontend/src/test/`, `frontend/e2e/`, and `docs/` are ignored by the deployment-oriented `.gitignore`; use `git add -f` for every test or documentation path even when an existing file is already tracked.
- Do not stage or rewrite unrelated tracked or untracked files.
- Stop and create a separate proposal if preserving behavior would require an API, route, schema, UI workflow, accessibility contract, or persisted-data change.

---

## File Structure

- `frontend/src/routes/InventoryPage.tsx` — retain page orchestration, query/mutation ownership, URL synchronization, selection and bulk state, alerts, and composition; remove only duplicated pure helpers and inline render-only components.
- `frontend/src/lib/inventoryFilters.ts` — single owner of inventory filter names/types and pure URL-to-view, view-to-URL, and API-query conversion functions; retain the existing signatures.
- `frontend/src/components/VmTable.tsx` — render the desktop inventory table and own only table-local inline-edit state and select-all indeterminate DOM state.
- `frontend/src/components/VmCard.tsx` — render the existing responsive VM card with no data fetching or mutation ownership.
- `frontend/src/test/InventoryPage.test.tsx` — route-level characterization for URL/query conversion, sort cycling, bulk filter payloads, selection, editing, roles, errors, and accessibility.
- `frontend/src/test/inventoryFilters.test.ts` — pure characterization of the URL/filter helper contract, initially through `InventoryPage.tsx`'s existing exports and retained re-exports.
- `frontend/src/test/InventoryIpColumn.test.tsx` — existing focused proof for the table IP-column behavior.
- `frontend/e2e/inventory.spec.ts` — existing browser proof for navigation, URL pagination/page size, table rendering, and bulk editing; no scenario changes are planned.
- `docs/superpowers/refactor/phase-1-baseline/ledger.md` — mark REF-003 resolved only after the focused and phase verification gates pass.
- `docs/superpowers/refactor/phase-4-inventory-page/README.md` — record the exact boundaries and successful verification commands for the independently reversible phase.

### Task 1: Characterize the Current Inventory Contracts

**Files:**
- Modify: `frontend/src/test/InventoryPage.test.tsx`
- Create: `frontend/src/test/inventoryFilters.test.ts`

**Interfaces:**
- Consumes: Current `InventoryPage`, `viewFromParams(params: URLSearchParams): ViewState`, and `paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams` exports from `frontend/src/routes/InventoryPage.tsx`.
- Produces: Regression proof for repeated filters, URL-to-API pagination conversion, the three-state sort cycle, bulk filter payload shape, table semantics, and inline-edit keyboard behavior. Later tasks must pass these tests without changing their expectations.

- [ ] **Step 1: Re-read the current route, tests, and API surface before writing characterization coverage**

Run:

```bash
devbox run -- bash -lc 'sed -n "1,220p" frontend/src/routes/InventoryPage.tsx; sed -n "1,360p" frontend/src/test/InventoryPage.test.tsx; sed -n "1,120p" frontend/src/api/vms.ts'
```

Expected: `InventoryPage.tsx` still owns inline `VmCard`/`VmTable` and duplicate URL helpers, while all VM requests still go through `vmsApi` from `frontend/src/api/vms.ts`. If the merge changed those boundaries, stop and revise this plan before editing.

- [ ] **Step 2: Add route-level URL, query, bulk-filter, accessibility, and inline-edit characterization tests**

Append these tests inside the existing `describe('InventoryPage', ...)` block in `frontend/src/test/InventoryPage.test.tsx`:

```tsx
  it('preserves repeated filters while converting page and size to API limit and offset', async () => {
    hoisted.searchParams = new URLSearchParams(
      'q=database&status=running&status=powered_off&page=2&size=25&sort=name&dir=desc',
    );
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList({ total: 100, limit: 25, offset: 25 }));

    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    await screen.findAllByText('web-01');
    const params = vi.mocked(vmsApi.listVms).mock.calls.at(-1)![0];
    expect(params.get('q')).toBe('database');
    expect(params.getAll('status')).toEqual(['running', 'powered_off']);
    expect(params.get('sort')).toBe('name');
    expect(params.get('dir')).toBe('desc');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('25');
    expect(params.has('page')).toBe(false);
    expect(params.has('size')).toBe(false);
  });

  it('cycles a sortable header from ascending to descending to unsorted URLs', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });
    const nameHeader = await screen.findByRole('button', { name: /Name/ });

    await userEvent.click(nameHeader);
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory?sort=name&dir=asc');
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory?sort=name&dir=desc');
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(hoisted.pushMock).toHaveBeenLastCalledWith('/inventory');
  });

  it('sends a scalar search and repeated facet arrays when bulk editing all matches', async () => {
    hoisted.searchParams = new URLSearchParams(
      'q=database&status=running&status=powered_off&environment=production',
    );
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(
      makeVmList({ items: [makeVm({ id: 'vm-01-id', name: 'vm-01' })], total: 50 }),
    );
    vi.spyOn(vmsApi, 'bulkUpdateVms').mockResolvedValue({ updated: 50, failed: [] });
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    await userEvent.click(await screen.findByLabelText('Select all'));
    await userEvent.click(screen.getByRole('button', { name: /Select all .* matching filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'high');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to all/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Edit' }));

    expect(vi.mocked(vmsApi.bulkUpdateVms)).toHaveBeenCalledWith({
      filters: {
        q: 'database',
        status: ['running', 'powered_off'],
        environment: ['production'],
      },
      patch: { criticality: 'high' },
    });
  });

  it('keeps table selection and sorting controls accessibly named and scoped', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'viewer' }) });

    const nameButton = await screen.findByRole('button', { name: /Name/ });
    const nameHeader = nameButton.closest('th');
    expect(nameHeader).toHaveAttribute('scope', 'col');
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select web-01' })).toBeInTheDocument();
  });

  it('commits an inline status edit with Enter and sends the existing PATCH shape', async () => {
    vi.spyOn(vmsApi, 'listVms').mockResolvedValue(makeVmList());
    vi.spyOn(vmsApi, 'updateVm').mockResolvedValue(makeVm({ status: 'powered_off' }));
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    const user = userEvent.setup();
    const statusCell = await screen.findByTestId('cell-status');
    await user.click(statusCell);
    const editor = screen.getByRole('combobox');
    await user.selectOptions(editor, 'powered_off');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(vmsApi.updateVm).toHaveBeenCalledWith('vm-1', { status: 'powered_off' });
    });
  });
```

- [ ] **Step 3: Add pure URL-helper characterization through the route's existing exports**

Create `frontend/src/test/inventoryFilters.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  paramsFromFilters,
  viewFromParams,
} from '../routes/InventoryPage';
import { emptyFilterState } from '../components/filters/filterConfig';

beforeEach(() => window.localStorage.clear());

describe('inventory URL state', () => {
  it('normalizes invalid view values and uses the stored valid page size', () => {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, '100');
    expect(viewFromParams(new URLSearchParams('page=-4&sort=not-a-column&dir=sideways'))).toEqual({
      page: 1,
      size: 100,
      sort: null,
      dir: 'asc',
    });
  });

  it('serializes repeated filters and omits default view values', () => {
    const filters = {
      ...emptyFilterState,
      q: ['database'],
      status: ['running', 'powered_off'],
      environment: ['production'],
    };
    const params = paramsFromFilters(filters, {
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      sort: null,
      dir: 'asc',
    });

    expect(params.toString()).toBe(
      'q=database&status=running&status=powered_off&environment=production',
    );
  });

  it('serializes non-default page, size, sort, and direction exactly', () => {
    const params = paramsFromFilters(emptyFilterState, {
      page: 3,
      size: 25,
      sort: 'updated_at',
      dir: 'desc',
    });
    expect(params.toString()).toBe('page=3&size=25&sort=updated_at&dir=desc');
  });
});
```

- [ ] **Step 4: Run the new characterization tests before any extraction**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run test src/test/InventoryPage.test.tsx src/test/inventoryFilters.test.ts'
```

Expected: PASS. A failure means the assertion does not describe the merged implementation; correct the characterization from observed current behavior rather than changing production code.

- [ ] **Step 5: Commit the characterization boundary**

```bash
git add -f frontend/src/test/InventoryPage.test.tsx frontend/src/test/inventoryFilters.test.ts
git diff --cached --check
git commit -m "test(frontend): characterize inventory route contracts"
```

### Task 2: Consolidate Inventory URL and Filter State

**Files:**
- Modify: `frontend/src/lib/inventoryFilters.ts`
- Modify: `frontend/src/routes/InventoryPage.tsx`
- Test: `frontend/src/test/inventoryFilters.test.ts`
- Test: `frontend/src/test/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: The characterized helper signatures and constant values from Task 1.
- Produces: `emptyFilters(): Filters`, `viewFromParams(params: URLSearchParams): ViewState`, `paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams`, `queryParamsFor(filters: Filters, view: ViewState): URLSearchParams`, `filtersFromParams(params: URLSearchParams): Filters`, and `hasActiveFilters(filters: Filters): boolean` owned by `frontend/src/lib/inventoryFilters.ts`. `InventoryPage.tsx` continues re-exporting its previously exported constants, types, and helpers for compatibility.

- [ ] **Step 1: Confirm the duplicate helper bodies are still byte-for-byte behaviorally equivalent**

Run:

```bash
devbox run -- bash -lc 'git diff --no-index <(sed -n "/^export const coreFilterNames/,/^const neutralChipClass/p" frontend/src/routes/InventoryPage.tsx | sed "s/^function /export function /; s/^const neutralChipClass/export const neutralChipClass/") <(sed -n "/^export const coreFilterNames/,$p" frontend/src/lib/inventoryFilters.ts) || true'
```

Expected: only formatting, the dynamic `emptyFilters` construction, exported visibility, and the `PAGE_SIZES` import differ; filter names, default values, sortable keys, URL serialization, and API query conversion remain equivalent. Any semantic difference must be covered by a characterization test before proceeding.

- [ ] **Step 2: Preserve the existing `PAGE_SIZES` route export through the helper module**

Change the first line of `frontend/src/lib/inventoryFilters.ts` to this exact two-line form:

```ts
import { PAGE_SIZES } from '../components/PaginationFooter';
export { PAGE_SIZES };
```

Do not change any helper body or constant value.

- [ ] **Step 3: Replace the duplicate declarations in `InventoryPage.tsx` with imports and compatibility re-exports**

Delete the block beginning with `export const coreFilterNames` and ending with `neutralChipClass`. Add this import after the existing library imports:

```ts
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  SORTABLE_COLUMNS,
  emptyFilters,
  filterNames,
  filtersFromParams,
  hasActiveFilters,
  humanize,
  paramsFromFilters,
  queryParamsFor,
  viewFromParams,
} from '../lib/inventoryFilters';
import type { Filters, ViewState } from '../lib/inventoryFilters';

export {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  SORTABLE_COLUMNS,
  advancedFilterNames,
  coreFilterNames,
  filterNames,
  paramsFromFilters,
  viewFromParams,
} from '../lib/inventoryFilters';
export type { FilterName, Filters, ViewState } from '../lib/inventoryFilters';
```

Keep `queryParamsFor`, `filtersFromParams`, `emptyFilters`, and `hasActiveFilters` internal to the route exactly as before. Do not change any call site, dependency array, `router.push` construction, query key, API invocation, or state transition.

- [ ] **Step 4: Run focused URL and route tests**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run test src/test/inventoryFilters.test.ts src/test/InventoryPage.test.tsx src/test/InventoryToolbar.test.tsx src/test/filterConfig.test.ts'
```

Expected: PASS with the same URL strings, query parameters, and bulk request bodies characterized in Task 1.

- [ ] **Step 5: Run lint and type checking for the consolidated ownership boundary**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck'
```

Expected: PASS with no duplicate-export, unused-import, ESLint, or TypeScript errors.

- [ ] **Step 6: Commit the URL/filter consolidation**

```bash
git add frontend/src/lib/inventoryFilters.ts frontend/src/routes/InventoryPage.tsx
git add -f frontend/src/test/inventoryFilters.test.ts frontend/src/test/InventoryPage.test.tsx
git diff --cached --check
git commit -m "refactor(frontend): consolidate inventory URL state"
```

### Task 3: Extract the Authoritative VM Table and Card Renderers

**Files:**
- Modify: `frontend/src/components/VmCard.tsx`
- Modify: `frontend/src/components/VmTable.tsx`
- Modify: `frontend/src/routes/InventoryPage.tsx`
- Test: `frontend/src/test/InventoryPage.test.tsx`
- Test: `frontend/src/test/InventoryIpColumn.test.tsx`

**Interfaces:**
- Consumes: `Vm` from `frontend/src/api/types.ts`, visible columns shaped as `{ key: string }[]`, `SORTABLE_COLUMNS`, `humanize`, shared UI classes, and the Task 1 behavior contract.
- Produces: `VmCard({ vm }: { vm: Vm }): JSX.Element` and `VmTable(props: VmTableProps): JSX.Element`, where `VmTableProps` is the existing prop shape: `vms`, `columns`, `selectedIds`, `onToggle`, `onToggleAll`, `sortKey`, `sortDir`, `onSort`, optional `canEdit`, and optional async `onUpdateCell`. No component owns queries, mutations, URL state, or bulk state.

- [ ] **Step 1: Reconfirm the inline implementations are still the rendered authority and inspect the unused extracted differences**

Run:

```bash
devbox run -- bash -lc 'grep -n "^function VmCard\|^function SortIcon\|^function VmTable\|^export function InventoryPage" frontend/src/routes/InventoryPage.tsx; git diff --no-index frontend/src/components/VmTable.tsx <(sed -n "/^function SortIcon/,/^export function InventoryPage/p" frontend/src/routes/InventoryPage.tsx) || true'
```

Expected: the route still defines and renders its inline functions. In particular, do not accidentally activate the extracted file's different blur handling, edit-error UI, focusability, title copy, header markup, row styling, or link styling.

- [ ] **Step 2: Make `VmCard.tsx` an exact extraction of the currently rendered inline card**

Use this exact script from the repository root; it copies the authoritative function body rather than hand-merging the divergent unused component:

```bash
devbox run -- python3 - <<'PY'
from pathlib import Path

route_path = Path('frontend/src/routes/InventoryPage.tsx')
route = route_path.read_text()
start = route.index('function VmCard')
end = route.index('

function SortIcon', start)
body = route[start:end].replace('function VmCard', 'export function VmCard', 1)
imports = """'use client';

import Link from 'next/link';
import type { Vm } from '../api/types';
import { Badge, cardClass, monoClass } from './ui';
import { cn } from '../lib/classNames';
import { formatDisks, formatMemory } from '../lib/units';

"""
Path('frontend/src/components/VmCard.tsx').write_text(imports + body + '
')
PY
```

Expected: the output retains the current link href, focus ring, typography, metrics, badges, owner, and tag summary exactly.

- [ ] **Step 3: Make `VmTable.tsx` an exact extraction of the currently rendered inline sort icon and table**

Use this exact script from the repository root:

```bash
devbox run -- python3 - <<'PY'
from pathlib import Path

route_path = Path('frontend/src/routes/InventoryPage.tsx')
route = route_path.read_text()
start = route.index('function SortIcon')
end = route.index('

export function InventoryPage', start)
body = route[start:end].replace('function VmTable', 'export function VmTable', 1)
imports = """'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Vm } from '../api/types';
import {
  Badge,
  inputClass,
  monoClass,
  selectClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableRowClass,
  tableWrapClass,
} from './ui';
import { COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { SORTABLE_COLUMNS, humanize } from '../lib/inventoryFilters';
import { formatMemory } from '../lib/units';
import { cn } from '../lib/classNames';

"""
Path('frontend/src/components/VmTable.tsx').write_text(imports + body + '
')
PY
```

Expected: the extracted table retains `scope="col"`, `aria-sort`, checkbox accessible names, select-all indeterminate handling, the current click/Enter/Escape/blur editing behavior, exact editable option sets, semantic badges, technical-value formatting, IP-role lookup, tag truncation, selected-row styling, and status-colored left border.

- [ ] **Step 4: Import the extracted renderers and remove only the inline definitions**

Add these imports to `frontend/src/routes/InventoryPage.tsx`:

```ts
import { VmCard } from '../components/VmCard';
import { VmTable } from '../components/VmTable';
```

Then delete from `function VmCard` through the closing brace of `function VmTable`, leaving `export function InventoryPage()` and everything below it unchanged. Remove only imports made unused by that deletion: `cn`, `Badge`, `cardClass`, `inputClass`, `monoClass`, `selectClass`, the table class constants, `COLUMN_LABELS`, `formatMemory`, `formatDisks`, `SORTABLE_COLUMNS`, and `humanize`. Retain `useRef`, because the page's search debounce still owns a ref.

The resulting route-level helper import must be exactly:

```ts
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  emptyFilters,
  filterNames,
  filtersFromParams,
  hasActiveFilters,
  paramsFromFilters,
  queryParamsFor,
  viewFromParams,
} from '../lib/inventoryFilters';
import type { Filters, ViewState } from '../lib/inventoryFilters';
```

Keep the compatibility re-export block from Task 2 unchanged.

- [ ] **Step 5: Run the table/card and route characterization tests**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run test src/test/InventoryPage.test.tsx src/test/InventoryIpColumn.test.tsx src/test/inventoryFilters.test.ts'
```

Expected: PASS. The desktop table and mobile card still render the same VM, URL/query and bulk tests retain identical payloads, IP roles retain identical cells, accessible header/checkbox expectations pass, and inline editing retains the same PATCH shape.

- [ ] **Step 6: Run frontend lint and type checking**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck'
```

Expected: PASS with no unused imports and no prop/type drift.

- [ ] **Step 7: Review the extraction-only diff and commit it**

Run:

```bash
git diff -- frontend/src/routes/InventoryPage.tsx frontend/src/components/VmCard.tsx frontend/src/components/VmTable.tsx
git diff --check
```

Expected: `InventoryPage.tsx` loses the inline renderers and gains imports; the component files match those removed bodies plus only the imports/exports needed to compile. There must be no changed copy, class, href, option value, event handler, ARIA attribute, API call, or state transition.

Commit:

```bash
git add frontend/src/routes/InventoryPage.tsx frontend/src/components/VmCard.tsx frontend/src/components/VmTable.tsx
git add -f frontend/src/test/InventoryPage.test.tsx frontend/src/test/InventoryIpColumn.test.tsx frontend/src/test/inventoryFilters.test.ts
git diff --cached --check
git commit -m "refactor(frontend): extract inventory renderers"
```

### Task 4: Run the Frontend Phase Gate and Record REF-003

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`
- Create: `docs/superpowers/refactor/phase-4-inventory-page/README.md`
- Verify: `frontend/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: The independently committed characterization, URL/filter consolidation, and renderer extraction from Tasks 1–3.
- Produces: A recorded, independently reversible resolution of REF-003 with focused Vitest, ESLint, TypeScript, Playwright, and graph evidence. This task does not change production or test behavior.

- [ ] **Step 1: Run the complete frontend unit suite**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run test'
```

Expected: PASS, including the Task 1 characterization and all existing toolbar, filters, bulk editor, API client, preference, and route tests.

- [ ] **Step 2: Run the frontend static gate**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck'
```

Expected: PASS.

- [ ] **Step 3: Run the existing browser inventory workflow**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bunx playwright test e2e/inventory.spec.ts'
```

Expected: PASS for VM creation/import visibility, `/inventory` search, `size=25`, `page=2`, row rendering, and selected-row bulk editing. Do not weaken or skip a scenario to make the refactor pass.

- [ ] **Step 4: Refresh the repository graph without forcing a safety refusal**

Run:

```bash
devbox run -- graphify update .
```

Expected: PASS and the graph maps `InventoryPage` to `VmTable`, `VmCard`, and `inventoryFilters`. If graphify refuses because the new graph has fewer nodes than the existing graph, record the refusal and stop; do not use `--force` without separate approval.

- [ ] **Step 5: Record the exact completed phase boundary**

Create `docs/superpowers/refactor/phase-4-inventory-page/README.md` with:

```markdown
# Phase 4 Inventory Page Structural Refactor

## Scope

Resolved REF-003 by consolidating inventory URL/filter conversion in `frontend/src/lib/inventoryFilters.ts` and extracting the currently rendered desktop table and responsive card into `frontend/src/components/VmTable.tsx` and `frontend/src/components/VmCard.tsx`.

`frontend/src/routes/InventoryPage.tsx` remains responsible for URL synchronization, TanStack Query and mutations, selection, select-all-matching, bulk editing, alerts, pagination orchestration, role gating, and page composition. No backend, API, route, schema, persistence, product behavior, accessibility behavior, or visual design changed.

## Verification

- `cd frontend && bun run test` — PASS
- `cd frontend && bun run lint && bun run typecheck` — PASS
- `cd frontend && bunx playwright test e2e/inventory.spec.ts` — PASS
- `graphify update .` — PASS

Characterization covers repeated URL filters, page/size-to-limit/offset conversion, three-state sorting, bulk filter payloads, selection semantics, accessible table headers and checkbox names, inline edit PATCH shape, responsive card/table rendering, IP-role columns, loading/errors, and role gating.
```

In `docs/superpowers/refactor/phase-1-baseline/ledger.md`, replace the REF-003 row with this exact row:

```markdown
| REF-003 | Frontend | `frontend/src/routes/InventoryPage.tsx` | oversized responsibility | Post-merge characterization proved URL/search-param conversion, API query shape, sorting, pagination, bulk selection/edit, inline editing, responsive rendering, and table accessibility before extraction. URL/filter helpers now have one owner in `frontend/src/lib/inventoryFilters.ts`; the exact rendered table and card bodies now live in `frontend/src/components/VmTable.tsx` and `frontend/src/components/VmCard.tsx`. | URL search params, filtering, sorting, pagination, bulk edit, inline edit, responsive rendering, accessibility | Retain `InventoryPage` as the query/mutation, URL synchronization, selection/bulk, alert, and composition owner; do not extract further without new evidence. | Medium | Inventory Vitest characterization, full frontend Vitest, ESLint, TypeScript, `frontend/e2e/inventory.spec.ts`, and graph refresh pass. | 4 | resolved |
```

- [ ] **Step 6: Verify only the intended phase files changed since the Task 3 commit**

Run:

```bash
git status --short
git diff --check
git diff -- docs/superpowers/refactor/phase-1-baseline/ledger.md docs/superpowers/refactor/phase-4-inventory-page/README.md
```

Expected: only the ledger and new Phase 4 README are uncommitted. Test reports, coverage output, Playwright artifacts, databases, and unrelated files must not be staged.

- [ ] **Step 7: Commit the verification record**

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/ledger.md docs/superpowers/refactor/phase-4-inventory-page/README.md
git diff --cached --check
git commit -m "docs: record inventory refactor verification"
```

## Stop Boundary

Stop after Task 4. Do not extract a URL hook, query hook, bulk-selection hook, bulk action bar, alert panel, export menu, or mutation service in this phase. Those responsibilities are coupled to page orchestration and lack separate evidence authorizing another boundary; any further split requires a new ledger finding, characterization, and implementation plan.
