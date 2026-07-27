# Inventory Pagination, Full-Field Import/Export, Bulk Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side pagination + sorting with a rows-per-page control to the inventory page, close every import/export field gap, and add bulk editing across pages.

**Architecture:** Sorting and paging move into SQL (`list_vms`) because a client-side sort over one page is a broken sort; the frontend keeps page/size/sort in the URL beside the existing filter params. Import and export both grow to full field parity and share cell formats so an export re-imports losslessly. Bulk edit is one new `POST /api/vms/bulk` route that resolves its target set from `ids` **or** the filter params (the same contract `/vms/export` already uses) and mutates through `services/vms.py::update_vm` so audit rows and `health_score` stay correct.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Postgres (Alembic for schema, none needed here), Next.js 15 App Router + React 19 + TanStack Query + Tailwind, pytest (real Postgres), Vitest + Playwright.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-27-inventory-pagination-bulk-edit-design.md`.
- Every state-changing route MUST declare `Csrf` — omitting it silently disables CSRF for that endpoint.
- Any VM mutation MUST go through `services/vms.py` (`update_vm`/`create_vm`), which writes audit rows and recomputes the denormalized `health_score`. Never `setattr` on a `Vm` in a route.
- All frontend HTTP goes through `frontend/src/api/client.ts`. Never call `fetch` from a component.
- Pages under `frontend/src/app/**` stay thin shells re-exporting from `frontend/src/routes/*`.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Vitest enforces 80% coverage on lines/statements/functions/branches.
- Backend tests hit real Postgres via `backend/tests/conftest.py`. Helpers: `create_user`, `login` (returns CSRF), `auth_headers(csrf)`, `vm_payload`, `create_vm_row`.
- Deliberate simplifications carry a `ponytail:` comment naming the ceiling.
- Backend commands run inside `devbox shell`; `just verify` is the full gate.
- No new dependency other than `xlsxwriter` (Task 7).

---

### Task 1: Backend sort + paginate

**Files:**
- Modify: `backend/app/services/vms.py:406-419` (`list_vms`), plus a new `SORT_COLUMNS` block above it
- Modify: `backend/app/api/routes/vms.py:80-94` (`list_inventory`)
- Test: `backend/tests/test_vm_sorting.py` (create)

**Interfaces:**
- Consumes: `apply_vm_filters(select(Vm), **filters)`, `VmFilterParams` (both already exist).
- Produces:
  - `SORT_COLUMNS: dict[str, Any]` and `SORT_PATTERN: str` in `app.services.vms`.
  - `list_vms(db, filters, limit, offset, sort=None, direction="asc") -> tuple[list[Vm], int]`.
  - `GET /api/vms` accepts `sort` (one of the `SORT_COLUMNS` keys) and `dir` (`asc`|`desc`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vm_sorting.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import auth_headers, create_user, create_vm_row, login


def _seed(db: Session, user) -> None:
    # Same updated_at ordering for all three, so only the sort key can decide.
    create_vm_row(db, user, name="alpha", criticality="low", cpu_cores=8)
    create_vm_row(db, user, name="bravo", criticality="critical", cpu_cores=2)
    create_vm_row(db, user, name="charlie", criticality="medium", cpu_cores=4)


def test_sort_by_name_ascending(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    _seed(db_session, user)
    login(client, user.email)

    response = client.get("/api/vms", params={"sort": "name", "dir": "asc"})

    assert response.status_code == 200
    assert [item["name"] for item in response.json()["items"]] == ["alpha", "bravo", "charlie"]


def test_sort_by_criticality_uses_severity_not_alphabet(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    _seed(db_session, user)
    login(client, user.email)

    response = client.get("/api/vms", params={"sort": "criticality", "dir": "asc"})

    # Alphabetically this would be critical, low, medium — severity order is the
    # only order a user would call correct.
    assert [item["criticality"] for item in response.json()["items"]] == [
        "critical",
        "medium",
        "low",
    ]


def test_pages_do_not_overlap_or_skip_under_sort(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    # Every row shares one criticality, so only the name tie-break gives a total order.
    for index in range(10):
        create_vm_row(db_session, user, name=f"vm-{index:02d}", criticality="medium")
    login(client, user.email)

    first = client.get("/api/vms", params={"sort": "criticality", "limit": 5, "offset": 0}).json()
    second = client.get("/api/vms", params={"sort": "criticality", "limit": 5, "offset": 5}).json()

    names = [item["name"] for item in first["items"]] + [item["name"] for item in second["items"]]
    assert len(names) == 10
    assert len(set(names)) == 10
    assert first["total"] == 10


def test_unknown_sort_key_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    login(client, user.email)

    assert client.get("/api/vms", params={"sort": "password_hash"}).status_code == 422
    assert client.get("/api/vms", params={"sort": "name", "dir": "sideways"}).status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_vm_sorting.py -v`
Expected: FAIL — sorted order comes back as `updated_at DESC` and the 422 assertions fail (unknown `sort` is currently ignored).

- [ ] **Step 3: Add the sort whitelist and thread it through `list_vms`**

In `backend/app/services/vms.py`, add `case` to the existing `sqlalchemy` import and insert above `list_vms`:

```python
# Enum columns sort by meaning, not by spelling: alphabetically `critical` would
# land between `archived` and `high`, which reads as a broken sort.
_CRITICALITY_ORDER = case(
    {
        Criticality.critical: 0,
        Criticality.high: 1,
        Criticality.medium: 2,
        Criticality.low: 3,
    },
    value=Vm.criticality,
)
_STATUS_ORDER = case(
    {
        VmStatus.running: 0,
        VmStatus.suspended: 1,
        VmStatus.powered_off: 2,
        VmStatus.unknown: 3,
        VmStatus.archived: 4,
        VmStatus.decommissioned: 5,
    },
    value=Vm.status,
)

# The single source of truth for sortable keys: the route pattern and the
# frontend column whitelist both derive from it, so they cannot drift.
SORT_COLUMNS: dict[str, Any] = {
    "name": Vm.name,
    "status": _STATUS_ORDER,
    "criticality": _CRITICALITY_ORDER,
    "health": Vm.health_score,
    "updated_at": Vm.updated_at,
    "cluster": Vm.cluster,
    "platform": Vm.platform,
    "environment": Vm.environment,
    "lifecycle": Vm.lifecycle,
    "cpu_cores": Vm.cpu_cores,
    "memory_mb": Vm.memory_mb,
    "owner": Vm.owner,
}
SORT_PATTERN = "^(" + "|".join(SORT_COLUMNS) + ")$"
```

Ensure `Criticality` and `VmStatus` are imported from `app.db.models` in this module (add them to the existing import list if absent).

Replace `list_vms` with:

```python
def list_vms(
    db: Session,
    filters: dict[str, Any],
    limit: int,
    offset: int,
    sort: str | None = None,
    direction: str = "asc",
) -> tuple[list[Vm], int]:
    base = apply_vm_filters(select(Vm), **filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    if sort is None:
        ordering = [Vm.updated_at.desc()]
    else:
        column = SORT_COLUMNS[sort]
        ordering = [column.desc() if direction == "desc" else column.asc()]
    items = db.scalars(
        base.options(
            selectinload(Vm.disks),
            selectinload(Vm.networks),
            selectinload(Vm.applications),
        )
        # Vm.name is the final tie-break on every ordering. Without a total order
        # Postgres may repeat or skip rows between pages.
        .order_by(*ordering, Vm.name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return list(items), total
```

- [ ] **Step 4: Accept the params on the route**

In `backend/app/api/routes/vms.py`, add `SORT_PATTERN` to the `from app.services.vms import (...)` block and replace `list_inventory`:

```python
@router.get("", response_model=VmList)
def list_inventory(
    db: DbSession,
    _: ViewerUser,
    filters: Annotated[VmFilterParams, Depends()],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: Annotated[str | None, Query(pattern=SORT_PATTERN)] = None,
    direction: Annotated[str, Query(alias="dir", pattern="^(asc|desc)$")] = "asc",
) -> VmList:
    items, total = list_vms(db, vars(filters), limit, offset, sort, direction)
    return VmList(
        items=[to_vm_read(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_vm_sorting.py tests/test_vm_filters.py -v`
Expected: PASS — new file green, existing filter tests unchanged (default ordering is still `updated_at DESC, name ASC`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/vms.py backend/app/api/routes/vms.py backend/tests/test_vm_sorting.py
git commit -m "feat(api): server-side sorting for the inventory list"
```

---

### Task 2: Frontend pagination + URL-driven sort

**Files:**
- Create: `frontend/src/components/PaginationFooter.tsx`
- Modify: `frontend/src/routes/InventoryPage.tsx` (params helpers at `:60-82`, `VmTable` at `:174-309`, `InventoryPage` at `:311-492`)
- Test: `frontend/src/test/PaginationFooter.test.tsx` (create), `frontend/src/test/InventoryPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET /api/vms?...&limit&offset&sort&dir` from Task 1; `api.listVms(params)` unchanged.
- Produces, exported from `InventoryPage.tsx`:
  - `PAGE_SIZES = [25, 50, 100, 200]`, `DEFAULT_PAGE_SIZE = 50`, `PAGE_SIZE_STORAGE_KEY = 'inventory-page-size'`
  - `type ViewState = { page: number; size: number; sort: string | null; dir: 'asc' | 'desc' }`
  - `viewFromParams(params: URLSearchParams): ViewState`
  - `paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams`
  - `SORTABLE_COLUMNS: Set<string>` (now the same key list the API accepts)
- Produces, from `PaginationFooter.tsx`:
  `PaginationFooter({ total, page, size, onPageChange, onSizeChange })`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/PaginationFooter.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaginationFooter } from '../components/PaginationFooter';

describe('PaginationFooter', () => {
  it('shows the row range and page count', () => {
    render(<PaginationFooter total={3412} page={3} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />);

    expect(screen.getByText('101–150 of 3,412')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 69')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <PaginationFooter total={100} page={1} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();

    rerender(<PaginationFooter total={100} page={2} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reports page and size changes', async () => {
    const onPageChange = vi.fn();
    const onSizeChange = vi.fn();
    render(<PaginationFooter total={500} page={2} size={50} onPageChange={onPageChange} onSizeChange={onSizeChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '100');
    expect(onSizeChange).toHaveBeenCalledWith(100);
  });

  it('renders nothing when everything fits on one page', () => {
    const { container } = render(
      <PaginationFooter total={12} page={1} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/PaginationFooter.test.tsx`
Expected: FAIL — `Failed to resolve import "../components/PaginationFooter"`.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/PaginationFooter.tsx`:

```tsx
'use client';

import { selectClass } from './ui';

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export function PaginationFooter({
  total,
  page,
  size,
  onPageChange,
  onSizeChange,
}: {
  total: number;
  page: number;
  size: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  // One page and a default page size means there is nothing to control.
  if (total <= PAGE_SIZES[0] && pageCount === 1) return null;

  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[var(--color-text-secondary)] dark:text-slate-400">
        <span className="tech tabular-nums">{first.toLocaleString()}–{last.toLocaleString()}</span>
        {' of '}
        <span className="tech tabular-nums">{total.toLocaleString()}</span>
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] dark:text-slate-400">
          <span className="whitespace-nowrap">Rows</span>
          <select
            aria-label="Rows per page"
            className={`${selectClass} w-auto py-1.5`}
            value={size}
            onChange={(event) => onSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[var(--color-border)] dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Prev
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[var(--color-border)] dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Next
          </button>
        </div>

        {/* Announced so a screen-reader user hears the page change, not just the rows swap. */}
        <p aria-live="polite" className="text-sm text-[var(--color-text-secondary)] tabular-nums dark:text-slate-400">
          Page {page} of {pageCount}
        </p>
      </div>
    </div>
  );
}
```

The range text is asserted as `101–150 of 3,412` — a single text node containing an en dash and `toLocaleString` grouping. Keep the spans inline so `getByText` matches the concatenated content.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/PaginationFooter.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire view state into `InventoryPage`**

In `frontend/src/routes/InventoryPage.tsx`:

Replace `paramsFromFilters` (`:60-71`) and add the view helpers next to it:

```tsx
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_STORAGE_KEY = 'inventory-page-size';

export type ViewState = { page: number; size: number; sort: string | null; dir: 'asc' | 'desc' };

// Keys the API accepts (services/vms.py::SORT_COLUMNS). 'health' maps to
// health_score server-side; keeping one list here stops the two from drifting.
const SORTABLE_COLUMNS = new Set([
  'name', 'status', 'criticality', 'health', 'updated_at',
  'cluster', 'platform', 'environment', 'lifecycle',
  'cpu_cores', 'memory_mb', 'owner',
]);

function storedPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZES.includes(stored as (typeof PAGE_SIZES)[number]) ? stored : DEFAULT_PAGE_SIZE;
}

export function viewFromParams(params: URLSearchParams): ViewState {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const rawSize = Number(params.get('size'));
  const size = PAGE_SIZES.includes(rawSize as (typeof PAGE_SIZES)[number]) ? rawSize : storedPageSize();
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return { page, size, sort: sort && SORTABLE_COLUMNS.has(sort) ? sort : null, dir };
}

function paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const values = filters[name];
    if (values.length > 0) {
      values.forEach((v) => params.append(name, v));
    }
  }
  if (view.page > 1) params.set('page', String(view.page));
  if (view.size !== DEFAULT_PAGE_SIZE) params.set('size', String(view.size));
  if (view.sort) {
    params.set('sort', view.sort);
    params.set('dir', view.dir);
  }
  return params;
}

// The wire format the API wants: page/size become limit/offset, page/size drop out.
function queryParamsFor(filters: Filters, view: ViewState): URLSearchParams {
  const params = paramsFromFilters(filters, view);
  params.delete('page');
  params.delete('size');
  params.set('limit', String(view.size));
  params.set('offset', String((view.page - 1) * view.size));
  return params;
}
```

Delete the old module-level `const SORTABLE_COLUMNS = new Set([...])` at `:149` and the `sortValue` helper at `:151-160` (now dead — sorting happens in SQL).

In `VmTable`, delete the `sorted` computation (`:201-208`) and map over `vms` directly at `:249`. Keep the `sortKey`/`sortDir`/`onSort` props — they now reflect URL state.

In `InventoryPage`:

```tsx
  const [view, setView] = useState<ViewState>(() => viewFromParams(searchParams));

  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
    setView(viewFromParams(searchParams));
  }, [searchParams]);

  function pushView(next: ViewState) {
    setView(next);
    const params = paramsFromFilters(filtersFromParams(searchParams), next);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  function handleSort(key: string) {
    // asc -> desc -> unsorted, the existing three-state cycle.
    if (view.sort !== key) pushView({ ...view, sort: key, dir: 'asc', page: 1 });
    else if (view.dir === 'asc') pushView({ ...view, dir: 'desc', page: 1 });
    else pushView({ ...view, sort: null, dir: 'asc', page: 1 });
  }

  function handleSizeChange(size: number) {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
    // ponytail: localStorage, not the user-preferences JSONB — upgrade to
    // /api/preferences if page size must follow the account across devices.
    pushView({ ...view, size, page: 1 });
    setSelectedIds(new Set());
  }

  function handlePageChange(page: number) {
    pushView({ ...view, page });
    setSelectedIds(new Set());
  }
```

Replace the two `useState` lines for `sortKey`/`sortDir` (`:320-321`) and the old `handleSort` (`:323-332`) with the above. The debounced filter effect (`:363-375`) keeps its shape but resets the page:

```tsx
      const params = paramsFromFilters(filters, { ...view, page: 1 });
      const current = paramsFromFilters(filtersFromParams(searchParams), viewFromParams(searchParams));
```

Query and clamping:

```tsx
  const queryParams = useMemo(
    () => queryParamsFor(filtersFromParams(searchParams), viewFromParams(searchParams)),
    [searchParams],
  );
  const vms = useQuery({ queryKey: ['vms', queryParams.toString()], queryFn: () => api.listVms(queryParams) });

  const items = vms.data?.items ?? [];
  const total = vms.data?.total ?? items.length;

  // A stale deep link can point past the end of a shrunken result set.
  useEffect(() => {
    if (!vms.data) return;
    const lastPage = Math.max(1, Math.ceil(total / view.size));
    if (view.page > lastPage) pushView({ ...view, page: lastPage });
  }, [vms.data, total, view.size, view.page]);
```

Pass `sortKey={view.sort}` and `sortDir={view.dir}` to `VmTable`, replace the `{items.length} of {total} shown` paragraph (`:417-421`) with the loading-only label, and render the footer after the table/card blocks:

```tsx
        {vms.data ? (
          <PaginationFooter
            total={total}
            page={view.page}
            size={view.size}
            onPageChange={handlePageChange}
            onSizeChange={handleSizeChange}
          />
        ) : null}
```

Import `PaginationFooter` from `'../components/PaginationFooter'`.

- [ ] **Step 6: Extend the page test**

Add to `frontend/src/test/InventoryPage.test.tsx` (match the file's existing render/mock helpers rather than inventing new ones):

```tsx
  it('requests the second page with limit and offset', async () => {
    // listVms mock resolves { items, total: 120, limit: 50, offset: 0 }
    renderInventory();
    await userEvent.click(await screen.findByRole('button', { name: 'Next page' }));

    const lastCall = vi.mocked(api.listVms).mock.calls.at(-1)![0];
    expect(lastCall.get('limit')).toBe('50');
    expect(lastCall.get('offset')).toBe('50');
  });

  it('sends sort and dir when a sortable column header is clicked', async () => {
    renderInventory();
    await userEvent.click(await screen.findByRole('button', { name: /Name/ }));

    const lastCall = vi.mocked(api.listVms).mock.calls.at(-1)![0];
    expect(lastCall.get('sort')).toBe('name');
    expect(lastCall.get('dir')).toBe('asc');
  });
```

- [ ] **Step 7: Run tests**

Run: `cd frontend && npx vitest run src/test/PaginationFooter.test.tsx src/test/InventoryPage.test.tsx`
Expected: PASS. If the existing InventoryPage tests assert `"20 of 20 shown"`, update those assertions — the label moved into the footer.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/PaginationFooter.tsx frontend/src/routes/InventoryPage.tsx frontend/src/test/PaginationFooter.test.tsx frontend/src/test/InventoryPage.test.tsx
git commit -m "feat(inventory): server-driven pagination with rows-per-page control"
```

---

### Task 3: Import `vm_type`

**Files:**
- Modify: `backend/app/services/csv_import.py:33-36` (`EXCLUDED_FROM_CSV`), `:58-64` (`ENUM_VALUES`), `:207` (`ENUM_HEADERS`)
- Test: `backend/tests/test_csv_imports.py` (extend)

**Interfaces:**
- Consumes: `normalize_csv_row`, `_commit_row`, `services/vms.py::_apply_vm_type_lifecycle` (all existing).
- Produces: `vm_type` becomes a valid CSV column; `ALL_HEADERS` (and therefore the `/api/imports/template` header row) gains it automatically.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_csv_imports.py`:

```python
def test_vm_type_column_is_imported(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    csrf = login(client, user.email)
    csv_bytes = (
        b"name,platform,cluster,vm_type,decommission_date\n"
        b"tmp-01,proxmox,pve-cluster-01,temporary,2026-09-01\n"
    )

    preview = client.post(
        "/api/imports",
        files={"file": ("vms.csv", csv_bytes, "text/csv")},
        headers=auth_headers(csrf),
    ).json()
    assert preview["rows"][0]["errors"] == []

    client.post(f"/api/imports/{preview['id']}/commit", headers=auth_headers(csrf))

    vm = db_session.scalar(select(Vm).where(Vm.name == "tmp-01"))
    assert vm is not None
    assert vm.vm_type.value == "temporary"
    # _apply_vm_type_lifecycle: temporary + a decommission date means retiring.
    assert vm.lifecycle.value == "retiring"


def test_template_offers_vm_type(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "viewer@example.com", role="viewer")
    login(client, user.email)

    headers = client.get("/api/imports/template").text.strip().split(",")

    assert "vm_type" in headers
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -k vm_type -v`
Expected: FAIL — the column is ignored, `vm_type` stays `permanent`, template lacks the header.

- [ ] **Step 3: Allow the column**

In `backend/app/services/csv_import.py`:

```python
# disks/networks are child collections expressed through CHILD_HEADERS instead.
# vm_type is importable and intentionally drives lifecycle gating through
# services/vms.py::_apply_vm_type_lifecycle, exactly as the VM form does.
EXCLUDED_FROM_CSV = {"disks", "networks"}
```

Add to `ENUM_VALUES`:

```python
    "vm_type": {"permanent", "temporary"},
```

Extend `ENUM_HEADERS`:

```python
ENUM_HEADERS = ("status", "environment", "criticality", "lifecycle", "os_family", "vm_type")
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -v`
Expected: PASS, including the pre-existing "a new VmBase field must be classified, not silently ignored" guard test.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "feat(import): accept vm_type as a CSV column"
```

---

### Task 4: Import the `applications` column

**Files:**
- Modify: `backend/app/services/csv_import.py:12-24` (imports), `:41-46` (`CHILD_HEADERS`), `_attach_children` at `:474-503`, `diff_against_vm` at `:408-456`, and a new `_parse_applications` helper next to `_parse_disks`
- Test: `backend/tests/test_csv_imports.py` (extend)

**Interfaces:**
- Consumes: `_clean_row`, `_error`, `CHILD_HEADERS` conventions from Task 3's module.
- Produces: `_parse_applications(row, field="applications", errors=None) -> list[tuple[str, str | None]]`; `applications` is a valid CSV column, additive on commit.

- [ ] **Step 1: Write the failing test**

```python
def test_applications_column_creates_children_and_is_idempotent(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    csrf = login(client, user.email)
    csv_bytes = (
        b"name,platform,cluster,applications\n"
        b"app-01,proxmox,pve-cluster-01,nginx:web-team;postgres\n"
    )

    for _ in range(2):
        preview = client.post(
            "/api/imports",
            files={"file": ("vms.csv", csv_bytes, "text/csv")},
            headers=auth_headers(csrf),
        ).json()
        assert preview["rows"][0]["errors"] == []
        client.post(f"/api/imports/{preview['id']}/commit", headers=auth_headers(csrf))

    vm = db_session.scalar(
        select(Vm).options(selectinload(Vm.applications)).where(Vm.name == "app-01")
    )
    assert vm is not None
    # Second import must not duplicate: uq_vm_applications_vm_app would raise.
    assert sorted((a.app_name, a.app_owner) for a in vm.applications) == [
        ("nginx", "web-team"),
        ("postgres", None),
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -k applications -v`
Expected: FAIL — `applications` is an unrecognized column, so no child rows exist.

- [ ] **Step 3: Parse and attach**

Add `VmApplication` to the `from app.db.models import (...)` block.

Register the column:

```python
CHILD_HEADERS = {"disks", "applications"} | set(IP_ROLE_HEADERS)
```

Add the parser below `_parse_disks`:

```python
def _parse_applications(
    row: dict[str, str], field: str = "applications", errors: list[dict[str, str]] | None = None
) -> list[tuple[str, str | None]]:
    """Parse a `name:owner;name` cell into (app_name, app_owner) pairs.

    Owner is optional. Duplicate names inside one cell collapse to the first,
    matching the uq_vm_applications_vm_app constraint.
    """
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    pairs: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        name, _, owner = cleaned.partition(":")
        name, owner = name.strip(), owner.strip()
        if not name:
            if errors is not None:
                errors.append(_error(field, "must be name or name:owner entries separated by ;"))
            return []
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        pairs.append((name, owner or None))
    return pairs
```

Validate it in `normalize_csv_row` beside the existing disk validation:

```python
    # Validation only. Child values stay in `raw` — `normalized` feeds
    # VmUpdate.model_validate, which would reject a `disks` key.
    _parse_disks(clean, "disks", errors)
    _parse_applications(clean, "applications", errors)
```

Attach in `_attach_children`, after the IP loop:

```python
    existing_apps = {(a.app_name or "").lower() for a in vm.applications}
    for app_name, app_owner in _parse_applications(clean):
        if app_name.lower() in existing_apps:
            continue
        existing_apps.add(app_name.lower())
        db.add(VmApplication(vm_id=vm.id, app_name=app_name, app_owner=app_owner))
```

Report it in `diff_against_vm`, inside the `if raw is not None:` block:

```python
        existing_apps = {(a.app_name or "").lower() for a in vm.applications}
        added_apps = [
            name for name, _owner in _parse_applications(clean) if name.lower() not in existing_apps
        ]
        if added_apps:
            changes["applications"] = [None, added_apps]
```

`_attach_children` and `diff_against_vm` both read `vm.applications`; confirm the VM is loaded with `selectinload(Vm.applications)` on the commit path (`_commit_row` → `db.get(Vm, ...)` lazy-loads inside the session, which is fine here).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "feat(import): applications column with additive child attach"
```

---

### Task 5: Import extended disk and IP cells

**Files:**
- Modify: `backend/app/services/csv_import.py` — `_parse_disks` at `:149-177`, a new `_parse_ips`, `_attach_children` at `:474-503`, `diff_against_vm` at `:420-443`
- Test: `backend/tests/test_csv_imports.py` (extend)

**Interfaces:**
- Produces:
  - `_parse_disks(...) -> list[tuple[str, int, str | None, str | None]]` — **the tuple widens from 2 to 4; every call site must unpack four values.**
  - `_parse_ips(row, field, errors=None) -> list[tuple[str, int | None, str | None]]` (address, vlan, gateway)

- [ ] **Step 1: Write the failing test**

```python
def test_extended_disk_and_ip_cells_are_parsed(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    csrf = login(client, user.email)
    csv_bytes = (
        b"name,platform,cluster,disks,private_ip\n"
        b"deep-01,proxmox,pve-cluster-01,scsi0:120:ssd-pool:thin,10.0.0.5:42:10.0.0.1\n"
    )

    preview = client.post(
        "/api/imports",
        files={"file": ("vms.csv", csv_bytes, "text/csv")},
        headers=auth_headers(csrf),
    ).json()
    assert preview["rows"][0]["errors"] == []
    client.post(f"/api/imports/{preview['id']}/commit", headers=auth_headers(csrf))

    vm = db_session.scalar(
        select(Vm)
        .options(selectinload(Vm.disks), selectinload(Vm.networks))
        .where(Vm.name == "deep-01")
    )
    assert vm is not None
    disk = vm.disks[0]
    assert (disk.disk_name, disk.size_gb, disk.storage_name, disk.storage_type) == (
        "scsi0", 120, "ssd-pool", "thin",
    )
    network = vm.networks[0]
    assert (network.ip_address, network.vlan, network.gateway) == ("10.0.0.5", 42, "10.0.0.1")


def test_short_disk_and_ip_forms_still_parse(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    csrf = login(client, user.email)
    csv_bytes = (
        b"name,platform,cluster,disks,private_ip\n"
        b"short-01,proxmox,pve-cluster-01,scsi0:80,10.0.0.9\n"
    )

    preview = client.post(
        "/api/imports",
        files={"file": ("vms.csv", csv_bytes, "text/csv")},
        headers=auth_headers(csrf),
    ).json()
    assert preview["rows"][0]["errors"] == []
    client.post(f"/api/imports/{preview['id']}/commit", headers=auth_headers(csrf))

    vm = db_session.scalar(
        select(Vm)
        .options(selectinload(Vm.disks), selectinload(Vm.networks))
        .where(Vm.name == "short-01")
    )
    assert vm is not None
    assert (vm.disks[0].disk_name, vm.disks[0].size_gb, vm.disks[0].storage_name) == ("scsi0", 80, None)
    assert (vm.networks[0].ip_address, vm.networks[0].vlan) == ("10.0.0.9", None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -k "extended_disk or short_disk" -v`
Expected: FAIL on the extended case (`scsi0:120:ssd-pool:thin` currently errors, because `size` is `120:ssd-pool:thin` and fails `isdigit()`); the short case passes.

- [ ] **Step 3: Widen the parsers**

Replace `_parse_disks`:

```python
def _parse_disks(
    row: dict[str, str], field: str = "disks", errors: list[dict[str, str]] | None = None
) -> list[tuple[str, int, str | None, str | None]]:
    """Parse `name:size[:storage_name[:storage_type]];…` into disk tuples.

    Returns [] for a blank cell, so a blank supplies nothing and the skip
    semantics hold. `errors` is optional because the classification and attach
    call sites re-parse a cell normalize_csv_row already proved valid.
    """
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    disks: list[tuple[str, int, str | None, str | None]] = []
    seen: set[str] = set()
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        fields = [segment.strip() for segment in cleaned.split(":")]
        if len(fields) < 2 or len(fields) > 4 or not fields[0] or not fields[1].isdigit():
            if errors is not None:
                errors.append(
                    _error(field, "must be name:size[:storage_name[:storage_type]] separated by ;")
                )
            return []
        name, size = fields[0], int(fields[1])
        storage_name = fields[2] or None if len(fields) > 2 else None
        storage_type = fields[3] or None if len(fields) > 3 else None
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        disks.append((name, size, storage_name, storage_type))
    return disks


def _parse_ips(
    row: dict[str, str], field: str, errors: list[dict[str, str]] | None = None
) -> list[tuple[str, int | None, str | None]]:
    """Parse `address[:vlan[:gateway]];…` into (address, vlan, gateway) tuples."""
    raw = str(row.get(field) or "").strip()
    if not raw:
        return []
    entries: list[tuple[str, int | None, str | None]] = []
    for part in raw.split(";"):
        cleaned = part.strip()
        if not cleaned:
            continue
        fields = [segment.strip() for segment in cleaned.split(":")]
        if len(fields) > 3 or not fields[0]:
            if errors is not None:
                errors.append(_error(field, "must be address[:vlan[:gateway]] separated by ;"))
            return []
        vlan_raw = fields[1] if len(fields) > 1 else ""
        if vlan_raw and not vlan_raw.isdigit():
            if errors is not None:
                errors.append(_error(field, "vlan must be a non-negative integer"))
            return []
        entries.append((
            fields[0],
            int(vlan_raw) if vlan_raw else None,
            (fields[2] or None) if len(fields) > 2 else None,
        ))
    return entries
```

`ponytail:` note to include above `_parse_ips` — IPv6 addresses contain colons and are therefore out of scope for this cell format; the VM form remains the path for them.

Validate IP cells in `normalize_csv_row`:

```python
    for header in IP_ROLE_HEADERS:
        _parse_ips(clean, header, errors)
```

Update the three call sites that unpack disks:

`_attach_children`:

```python
    for disk_name, size_gb, storage_name, storage_type in _parse_disks(clean):
        if disk_name.lower() in existing_disks:
            continue
        existing_disks.add(disk_name.lower())
        db.add(
            VmDisk(
                vm_id=vm.id,
                disk_name=disk_name,
                size_gb=size_gb,
                storage_name=storage_name,
                storage_type=storage_type,
                sort_order=disk_order,
            )
        )
        disk_order += 1

    existing_ips = {n.ip_address for n in vm.networks}
    ip_order = len(vm.networks)
    for header, role in IP_ROLE_HEADERS.items():
        for ip_address, vlan, gateway in _parse_ips(clean, header):
            if ip_address in existing_ips:
                continue
            existing_ips.add(ip_address)
            db.add(
                VmNetwork(
                    vm_id=vm.id,
                    ip_address=ip_address,
                    role=role,
                    vlan=vlan,
                    gateway=gateway,
                    sort_order=ip_order,
                )
            )
            ip_order += 1
```

`diff_against_vm`:

```python
        added_disks = [
            f"{name}:{size}"
            for name, size, _storage_name, _storage_type in _parse_disks(clean)
            if name.lower() not in existing_disks
        ]
        ...
        seen_ips = {n.ip_address for n in vm.networks}
        for header in IP_ROLE_HEADERS:
            added_ips = []
            for ip_address, _vlan, _gateway in _parse_ips(clean, header):
                if ip_address in seen_ips:
                    continue
                seen_ips.add(ip_address)
                added_ips.append(ip_address)
            if added_ips:
                changes[header] = [None, added_ips]
```

- [ ] **Step 4: Run the whole import suite**

Run: `cd backend && uv run pytest tests/test_csv_imports.py -v`
Expected: PASS. Any remaining failure is a 2-tuple unpack that was missed — grep `_parse_disks(` and `_parse_list(clean, header)` to confirm every call site moved.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "feat(import): storage and vlan detail in disk and IP cells"
```

---

### Task 6: Export every field (CSV)

**Files:**
- Modify: `backend/app/api/routes/vms.py:142-203` (`_EXPORT_COLS`, `export_vms`)
- Test: `backend/tests/test_vm_export.py` (create)

**Interfaces:**
- Consumes: `IP_ROLE_HEADERS` from `app.services.csv_import` (import it — the export cell shapes must stay tied to what the importer accepts).
- Produces: `_EXPORT_SCALAR_COLS`, `_EXPORT_CHILD_COLS`, `_EXPORT_COLS`, `_export_row(vm) -> dict[str, Any]` in `app.api.routes.vms`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vm_export.py`:

```python
import csv
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes.vms import _EXPORT_SCALAR_COLS
from app.db.models import Vm, VmApplication, VmDisk, VmNetwork
from tests.conftest import create_user, create_vm_row, login

# Columns a documentation export has no business carrying.
_NOT_EXPORTED = {"id", "created_by_id", "updated_by_id"}


def test_every_model_column_is_exported() -> None:
    model_columns = {col.name for col in Vm.__table__.columns} - _NOT_EXPORTED

    # Regression guard: the old list carried `vcpu` and `memory_gb`, which are
    # not model fields, so both columns shipped empty on every export.
    assert model_columns - set(_EXPORT_SCALAR_COLS) == set()
    assert set(_EXPORT_SCALAR_COLS) - model_columns == set()


def test_export_carries_values_and_children(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    vm = create_vm_row(db_session, user, name="ex-01", cpu_cores=6, memory_mb=8192)
    db_session.add_all([
        VmDisk(vm_id=vm.id, disk_name="scsi0", size_gb=120, storage_name="ssd", storage_type="thin"),
        VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", role="private", vlan=42, gateway="10.0.0.1"),
        VmApplication(vm_id=vm.id, app_name="nginx", app_owner="web-team"),
    ])
    db_session.commit()
    login(client, user.email)

    response = client.get("/api/vms/export")

    assert response.status_code == 200
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["cpu_cores"] == "6"
    assert row["memory_mb"] == "8192"
    assert row["disks"] == "scsi0:120:ssd:thin"
    assert row["private_ip"] == "10.0.0.5:42:10.0.0.1"
    assert row["applications"] == "nginx:web-team"
    assert row["monitoring_enabled"] in {"true", "false"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_vm_export.py -v`
Expected: FAIL — `_EXPORT_SCALAR_COLS` does not exist.

- [ ] **Step 3: Rewrite the column list and row builder**

In `backend/app/api/routes/vms.py`, replace `_EXPORT_COLS` (`:142-165`) with:

```python
# Ordered for a human reading the sheet left-to-right: identity, placement,
# classification, capacity, OS, ownership, operations, dates, derived.
_EXPORT_SCALAR_COLS = [
    "name",
    "external_id",
    "fqdn",
    "platform",
    "datacenter",
    "sr_id",
    "cluster",
    "node",
    "status",
    "environment",
    "criticality",
    "lifecycle",
    "vm_type",
    "cpu_cores",
    "memory_mb",
    "os_family",
    "os_name",
    "os_distribution",
    "os_version",
    "owner",
    "business_owner",
    "technical_owner",
    "pmp_enabled",
    "monitoring_enabled",
    "backup_enabled",
    "backup_location",
    "ha_enabled",
    "tags",
    "last_patch_date",
    "last_vuln_scan_date",
    "security_remarks",
    "decommission_date",
    "last_verified_at",
    "description",
    "health_score",
    "created_at",
    "updated_at",
]
# Child cells reuse the importer's formats, so an export re-imports losslessly.
_EXPORT_CHILD_COLS = ["disks", *IP_ROLE_HEADERS, "applications"]
_EXPORT_COLS = [*_EXPORT_SCALAR_COLS, *_EXPORT_CHILD_COLS]


def _join_fields(*fields: object) -> str:
    """Join child sub-fields on ':', dropping empty trailing ones."""
    parts = ["" if field is None else str(field) for field in fields]
    while parts and parts[-1] == "":
        parts.pop()
    return ":".join(parts)


def _export_row(vm: Vm) -> dict[str, object]:
    row: dict[str, object] = {col: getattr(vm, col) for col in _EXPORT_SCALAR_COLS}
    row["tags"] = ";".join(vm.tags or [])
    # true/false, not Yes/No: _parse_bool accepts these, so the round-trip holds.
    for flag in ("pmp_enabled", "monitoring_enabled", "backup_enabled", "ha_enabled"):
        row[flag] = "true" if getattr(vm, flag) else "false"
    row["disks"] = ";".join(
        _join_fields(d.disk_name, d.size_gb, d.storage_name, d.storage_type) for d in vm.disks
    )
    for header, role in IP_ROLE_HEADERS.items():
        row[header] = ";".join(
            _join_fields(n.ip_address, n.vlan, n.gateway) for n in vm.networks if n.role == role
        )
    row["applications"] = ";".join(
        _join_fields(a.app_name, a.app_owner) for a in vm.applications
    )
    return row
```

Add `from app.services.csv_import import IP_ROLE_HEADERS` to the imports.

Rewrite the generator inside `export_vms` and load all three child collections:

```python
    vms = list(
        db.scalars(
            base_q.options(
                selectinload(Vm.applications),
                selectinload(Vm.disks),
                selectinload(Vm.networks),
            ).order_by(Vm.name.asc())
        )
    )

    def generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLS)
        writer.writeheader()
        yield buf.getvalue()
        for vm in vms:
            buf.seek(0)
            buf.truncate()
            writer.writerow(_export_row(vm))
            yield buf.getvalue()
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_vm_export.py -v`
Expected: PASS. If `test_every_model_column_is_exported` reports a diff, add the named column to `_EXPORT_SCALAR_COLS` — the test is the contract.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/vms.py backend/tests/test_vm_export.py
git commit -m "fix(export): export every VM field and repair the vcpu/memory_gb phantoms"
```

---

### Task 7: xlsx export format

**Files:**
- Modify: `backend/pyproject.toml` (add `xlsxwriter`), `backend/app/api/routes/vms.py` (`export_vms`)
- Modify: `frontend/src/api/client.ts:449-452` (export URL helpers), `frontend/src/routes/InventoryPage.tsx` (header actions + bulk bar)
- Test: `backend/tests/test_vm_export.py` (extend), `frontend/src/test/InventoryPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `_EXPORT_COLS`, `_export_row` from Task 6.
- Produces:
  - `GET /api/vms/export?format=xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, filename `vm-inventory.xlsx`.
  - `api.exportVmsUrl(params?, format?)` and `api.exportSelectedUrl(ids, format?)` in `client.ts`.

- [ ] **Step 1: Write the failing test**

```python
def test_xlsx_export_has_a_header_row_for_every_column(
    client: TestClient, db_session: Session
) -> None:
    import zipfile

    user = create_user(db_session, "admin@example.com", role="admin")
    create_vm_row(db_session, user, name="ex-01")
    login(client, user.email)

    response = client.get("/api/vms/export", params={"format": "xlsx"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "vm-inventory.xlsx" in response.headers["content-disposition"]
    # A valid xlsx is a zip holding the workbook part; shared strings must carry
    # the header labels.
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    shared = archive.read("xl/sharedStrings.xml").decode()
    for column in ("name", "cpu_cores", "applications"):
        assert f"<t>{column}</t>" in shared


def test_csv_stays_the_default_format(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "admin@example.com", role="admin")
    login(client, user.email)

    response = client.get("/api/vms/export")

    assert response.headers["content-type"].startswith("text/csv")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_vm_export.py -k xlsx -v`
Expected: FAIL — `format` is an unknown query param and the response is CSV.

- [ ] **Step 3: Add the dependency**

In `backend/pyproject.toml`, append to `dependencies`:

```toml
  "xlsxwriter",
```

Run: `cd backend && uv sync`

- [ ] **Step 4: Implement the xlsx branch**

In `export_vms`, add the param and split on it:

```python
@router.get("/export")
def export_vms(
    db: DbSession,
    _: ViewerUser,
    filters: Annotated[VmFilterParams, Depends()],
    ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    all_vms: Annotated[bool, Query(alias="all")] = False,
    export_format: Annotated[str, Query(alias="format", pattern="^(csv|xlsx)$")] = "csv",
) -> Response:
```

Keep the existing query construction, then:

```python
    if export_format == "xlsx":
        return _xlsx_response(vms)
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vm-inventory.csv"'},
    )
```

Add above the route:

```python
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(vms: list[Vm]) -> Response:
    """Build a single-sheet workbook in memory.

    constant_memory keeps rows from accumulating as Python objects — they are
    flushed to the archive as each row is written, so a 200-row page and a
    full-fleet export cost roughly the same resident memory.
    """
    import xlsxwriter

    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"constant_memory": True, "in_memory": True})
    sheet = workbook.add_worksheet("Inventory")
    header_format = workbook.add_format({"bold": True})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})

    for index, column in enumerate(_EXPORT_COLS):
        sheet.write_string(0, index, column, header_format)
        sheet.set_column(index, index, max(12, min(len(column) + 4, 40)))
    sheet.freeze_panes(1, 0)

    for row_index, vm in enumerate(vms, start=1):
        row = _export_row(vm)
        for column_index, column in enumerate(_EXPORT_COLS):
            value = row[column]
            if value is None:
                continue
            if isinstance(value, datetime):
                sheet.write_datetime(row_index, column_index, value.replace(tzinfo=None), date_format)
            elif isinstance(value, date):
                sheet.write_datetime(row_index, column_index, value, date_format)
            elif isinstance(value, int) and not isinstance(value, bool):
                sheet.write_number(row_index, column_index, value)
            else:
                sheet.write_string(row_index, column_index, str(value))

    # autofilter after the data so the range covers every written row.
    sheet.autofilter(0, 0, max(len(vms), 1), len(_EXPORT_COLS) - 1)
    workbook.close()
    buffer.seek(0)
    return Response(
        content=buffer.getvalue(),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="vm-inventory.xlsx"'},
    )
```

Add `Response` to the `fastapi` import and `from datetime import date, datetime` to the module imports. Drop `response_class=StreamingResponse` from the decorator, since the route now returns either type.

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run pytest tests/test_vm_export.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Expose both formats in the client and the page**

`frontend/src/api/client.ts`:

```ts
  exportVmsUrl: (params?: URLSearchParams, format: 'csv' | 'xlsx' = 'csv') => {
    const query = new URLSearchParams(params ?? undefined);
    if (format !== 'csv') query.set('format', format);
    return query.toString() ? `${API_PREFIX}/vms/export?${query.toString()}` : `${API_PREFIX}/vms/export`;
  },
  exportSelectedUrl: (ids: string[], format: 'csv' | 'xlsx' = 'csv') => {
    const query = new URLSearchParams(ids.map((id) => ['ids', id]));
    if (format !== 'csv') query.set('format', format);
    return `${API_PREFIX}/vms/export?${query.toString()}`;
  },
```

In `InventoryPage.tsx`, replace the single export link in `PageHeader` actions (`:401-403`) with two:

```tsx
              <a href={api.exportVmsUrl(queryParams, 'csv')} download="vm-inventory.csv" className={secondaryButtonClass}>
                Export CSV
              </a>
              <a href={api.exportVmsUrl(queryParams, 'xlsx')} download="vm-inventory.xlsx" className={secondaryButtonClass}>
                Export Excel
              </a>
```

`queryParams` carries `limit`/`offset`; the export route ignores both, so no extra plumbing is needed. In the bulk bar, replace the single `Export` button with `CSV` and `Excel` buttons calling `api.exportSelectedUrl([...selectedIds], format)`.

- [ ] **Step 7: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/InventoryPage.test.tsx src/test/apiClient.test.ts`
Expected: PASS. Update any assertion that queried the old `Export filtered` label.

- [ ] **Step 8: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app/api/routes/vms.py backend/tests/test_vm_export.py frontend/src/api/client.ts frontend/src/routes/InventoryPage.tsx frontend/src/test
git commit -m "feat(export): opt-in xlsx workbook alongside the CSV export"
```

---

### Task 8: Bulk update endpoint

**Files:**
- Modify: `backend/app/schemas/vms.py` (add `VmBulkFilters`, `VmBulkUpdate`, `VmBulkRequest`, `VmBulkResult`)
- Create: `backend/app/services/vms_bulk.py`
- Modify: `backend/app/api/routes/vms.py` (add the route **above** `/{vm_id}` so the literal path wins)
- Test: `backend/tests/test_vm_bulk.py` (create)

**Interfaces:**
- Consumes: `apply_vm_filters`, `update_vm`, `VmUpdate`, `VmFilterParams` field names.
- Produces:
  - `BULK_MAX = 1000` and `bulk_update_vms(db, *, target, patch, user) -> dict[str, Any]` in `app.services.vms_bulk`
  - `POST /api/vms/bulk` → `{"updated": int, "failed": [{"id": str, "message": str}]}`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vm_bulk.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, Vm
from tests.conftest import auth_headers, create_user, create_vm_row, login


def test_bulk_update_by_ids_writes_audit_rows(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    first = create_vm_row(db_session, user, name="bulk-01", criticality="low")
    second = create_vm_row(db_session, user, name="bulk-02", criticality="low")
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"ids": [str(first.id), str(second.id)], "patch": {"criticality": "critical"}},
        headers=auth_headers(csrf),
    )

    assert response.status_code == 200
    assert response.json() == {"updated": 2, "failed": []}
    db_session.expire_all()
    assert {vm.criticality.value for vm in db_session.scalars(select(Vm))} == {"critical"}
    audit = db_session.scalars(select(AuditLog).where(AuditLog.field_name == "criticality")).all()
    assert len(audit) == 2


def test_bulk_update_by_filters_targets_the_filtered_set(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    create_vm_row(db_session, user, name="prod-01", environment="production", owner=None)
    create_vm_row(db_session, user, name="dev-01", environment="development", owner=None)
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"filters": {"environment": ["production"]}, "patch": {"owner": "ops"}},
        headers=auth_headers(csrf),
    )

    assert response.json()["updated"] == 1
    db_session.expire_all()
    owners = {vm.name: vm.owner for vm in db_session.scalars(select(Vm))}
    assert owners == {"prod-01": "ops", "dev-01": None}


def test_tags_are_added_and_removed_not_replaced(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="tagged-01", tags=["keep", "drop"])
    csrf = login(client, user.email)

    client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"tags_add": ["new"], "tags_remove": ["drop"]}},
        headers=auth_headers(csrf),
    )

    db_session.expire_all()
    assert sorted(db_session.get(Vm, vm.id).tags) == ["keep", "new"]


def test_health_score_is_recomputed(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="health-01", owner=None, business_owner=None)
    before = vm.health_score
    csrf = login(client, user.email)

    client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"owner": "ops", "business_owner": "finance"}},
        headers=auth_headers(csrf),
    )

    db_session.expire_all()
    assert db_session.get(Vm, vm.id).health_score > before


def test_viewer_is_forbidden_and_missing_csrf_is_rejected(
    client: TestClient, db_session: Session
) -> None:
    viewer = create_user(db_session, "viewer@example.com", role="viewer")
    vm = create_vm_row(db_session, viewer, name="rbac-01")
    csrf = login(client, viewer.email)

    forbidden = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"status": "running"}},
        headers=auth_headers(csrf),
    )
    assert forbidden.status_code == 403

    editor = create_user(db_session, "editor@example.com", role="editor")
    login(client, editor.email)
    no_csrf = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"status": "running"}},
    )
    assert no_csrf.status_code == 403


def test_both_or_neither_target_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="target-01")
    csrf = login(client, user.email)

    assert client.post(
        "/api/vms/bulk",
        json={"patch": {"status": "running"}},
        headers=auth_headers(csrf),
    ).status_code == 422
    assert client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "filters": {}, "patch": {"status": "running"}},
        headers=auth_headers(csrf),
    ).status_code == 422


def test_empty_patch_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, "editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="nochange-01")
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {}},
        headers=auth_headers(csrf),
    )

    assert response.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_vm_bulk.py -v`
Expected: FAIL — every request 404s or is swallowed by `GET /{vm_id}`; the route does not exist.

- [ ] **Step 3: Add the schemas**

Append to `backend/app/schemas/vms.py`:

```python
class VmBulkFilters(BaseModel):
    """Body mirror of api/routes/vms.py::VmFilterParams.

    The route's filter set is a query dataclass and cannot be reused in a JSON
    body, so the field names are duplicated here deliberately; the bulk test
    asserts the two stay in step.
    """

    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    platform: list[Platform] | None = None
    cluster: list[str] | None = None
    status: list[VmStatus] | None = None
    environment: list[Environment] | None = None
    criticality: list[Criticality] | None = None
    lifecycle: list[Lifecycle] | None = None
    monitoring_enabled: bool | None = None
    node: list[str] | None = None
    os_family: list[OsFamily] | None = None
    owner: list[str] | None = None
    pmp_enabled: bool | None = None
    tag: list[str] | None = None
    application: list[str] | None = None
    ip_role: list[NetworkRole] | None = None
    health: str | None = None


class VmBulkUpdate(BaseModel):
    """Fields safe to set across many VMs at once.

    Identity fields (name, fqdn, external_id, sr_id) are excluded: they are
    per-VM unique, so bulk-setting them collides. Tags are add/remove rather
    than replace — a replace across a page of VMs destroys per-VM tags.
    """

    model_config = ConfigDict(extra="forbid")

    status: VmStatus | None = None
    environment: Environment | None = None
    criticality: Criticality | None = None
    lifecycle: Lifecycle | None = None
    vm_type: VmType | None = None
    cluster: str | None = None
    node: str | None = None
    datacenter: str | None = None
    owner: str | None = None
    business_owner: str | None = None
    technical_owner: str | None = None
    pmp_enabled: bool | None = None
    monitoring_enabled: bool | None = None
    backup_enabled: bool | None = None
    ha_enabled: bool | None = None
    backup_location: str | None = None
    last_verified_at: date | None = None
    tags_add: list[str] = []
    tags_remove: list[str] = []


class VmBulkRequest(BaseModel):
    ids: list[uuid.UUID] | None = None
    filters: VmBulkFilters | None = None
    patch: VmBulkUpdate

    @model_validator(mode="after")
    def exactly_one_target(self) -> "VmBulkRequest":
        if (self.ids is None) == (self.filters is None):
            raise ValueError("supply exactly one of ids or filters")
        if self.ids is not None and not self.ids:
            raise ValueError("ids must not be empty")
        if not self.patch.model_fields_set:
            raise ValueError("patch must set at least one field")
        return self


class VmBulkFailure(BaseModel):
    id: uuid.UUID
    message: str


class VmBulkResult(BaseModel):
    updated: int
    failed: list[VmBulkFailure]
```

Add `VmType` to the module's `app.db.models` import if it is not already there.

- [ ] **Step 4: Write the service**

Create `backend/app/services/vms_bulk.py`:

```python
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User, Vm
from app.schemas.vms import VmBulkRequest, VmUpdate
from app.services.vms import apply_vm_filters, update_vm

# A mis-set filter should not be able to rewrite the whole fleet in one request.
BULK_MAX = 1000


def _resolve_targets(db: Session, payload: VmBulkRequest) -> list[Vm]:
    if payload.ids is not None:
        stmt = select(Vm).where(Vm.id.in_(payload.ids))
    else:
        assert payload.filters is not None
        filters = payload.filters.model_dump()
        # apply_vm_filters names the status kwarg status_value, matching the
        # query dataclass alias.
        filters["status_value"] = filters.pop("status")
        stmt = apply_vm_filters(select(Vm), **filters)
    vms = list(db.scalars(stmt.order_by(Vm.name.asc())))
    if len(vms) > BULK_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{len(vms)} VMs matched; bulk edit is limited to {BULK_MAX}",
        )
    return vms


def _patch_for(vm: Vm, payload: VmBulkRequest) -> VmUpdate:
    values = payload.patch.model_dump(
        exclude_unset=True, exclude={"tags_add", "tags_remove"}
    )
    if payload.patch.tags_add or payload.patch.tags_remove:
        removals = {tag.lower() for tag in payload.patch.tags_remove}
        kept = [tag for tag in (vm.tags or []) if tag.lower() not in removals]
        existing = {tag.lower() for tag in kept}
        kept.extend(tag for tag in payload.patch.tags_add if tag.lower() not in existing)
        values["tags"] = kept
    return VmUpdate.model_validate(values)


def bulk_update_vms(db: Session, *, payload: VmBulkRequest, user: User) -> dict[str, Any]:
    """Apply one patch to many VMs, one `update_vm` call each.

    Partial success is deliberate: a single bad row must not waste a 900-VM
    operation, so failures are collected and reported per id.
    """
    updated = 0
    failed: list[dict[str, Any]] = []
    for vm in _resolve_targets(db, payload):
        try:
            update_vm(db, vm, _patch_for(vm, payload), user)
            updated += 1
        except HTTPException as exc:
            db.rollback()
            failed.append({"id": vm.id, "message": str(exc.detail)})
    return {"updated": updated, "failed": failed}
```

Confirm `apply_vm_filters`' keyword names against `backend/app/services/vms.py:266-296` before finishing this step; `VmBulkFilters` must map onto them exactly (the `status` → `status_value` rename above is the one known mismatch — add any other the signature reveals, and drop the `_op` operator kwargs, which keep their defaults for bulk).

- [ ] **Step 5: Add the route**

In `backend/app/api/routes/vms.py`, insert **before** `@router.get("/{vm_id}")` (a literal path declared after the parameterized one is unreachable):

```python
@router.post("/bulk", response_model=VmBulkResult)
def bulk_update(
    payload: VmBulkRequest, db: DbSession, current_user: EditorUser, _: Csrf
) -> VmBulkResult:
    result = bulk_update_vms(db, payload=payload, user=current_user)
    return VmBulkResult.model_validate(result)
```

Import `VmBulkRequest`, `VmBulkResult` from `app.schemas.vms` and `bulk_update_vms` from `app.services.vms_bulk`.

- [ ] **Step 6: Run tests**

Run: `cd backend && uv run pytest tests/test_vm_bulk.py -v`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/vms.py backend/app/services/vms_bulk.py backend/app/api/routes/vms.py backend/tests/test_vm_bulk.py
git commit -m "feat(api): bulk VM update by ids or filters"
```

---

### Task 9: Bulk edit drawer

**Files:**
- Create: `frontend/src/components/BulkEditDrawer.tsx`
- Modify: `frontend/src/api/client.ts` (add `bulkUpdateVms` + types), `frontend/src/routes/InventoryPage.tsx` (selection mode + bulk bar + drawer mount)
- Test: `frontend/src/test/BulkEditDrawer.test.tsx` (create), `frontend/src/test/InventoryPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `POST /api/vms/bulk` from Task 8; `Drawer`, `primaryButtonClass`, `secondaryButtonClass`, `selectClass`, `inputClass`, `labelClass`, `Alert` from `components/ui`.
- Produces:
  - In `client.ts`: `type BulkPatch`, `type BulkResult`, `bulkUpdateVms(body: { ids?: string[]; filters?: Record<string, unknown>; patch: BulkPatch }) => Promise<BulkResult>`
  - `BulkEditDrawer({ open, onClose, targetLabel, onSubmit, pending, error })`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/BulkEditDrawer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BulkEditDrawer } from '../components/BulkEditDrawer';

function open(onSubmit = vi.fn()) {
  render(
    <BulkEditDrawer open onClose={vi.fn()} targetLabel="12 VMs" onSubmit={onSubmit} pending={false} />,
  );
  return onSubmit;
}

describe('BulkEditDrawer', () => {
  it('labels the apply button with the target', () => {
    open();
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeInTheDocument();
  });

  it('sends only the fields the user touched', async () => {
    const onSubmit = open();

    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'critical');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));

    expect(onSubmit).toHaveBeenCalledWith({ criticality: 'critical' });
  });

  it('sends tag additions and removals separately', async () => {
    const onSubmit = open();

    await userEvent.type(screen.getByLabelText('Add tags'), 'prod, eu-west');
    await userEvent.type(screen.getByLabelText('Remove tags'), 'legacy');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));

    expect(onSubmit).toHaveBeenCalledWith({
      tags_add: ['prod', 'eu-west'],
      tags_remove: ['legacy'],
    });
  });

  it('keeps apply disabled until something changes', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/BulkEditDrawer.test.tsx`
Expected: FAIL — `Failed to resolve import "../components/BulkEditDrawer"`.

- [ ] **Step 3: Write the drawer**

Create `frontend/src/components/BulkEditDrawer.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/BulkEditDrawer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the client method**

In `frontend/src/api/client.ts`, beside the other VM methods:

```ts
  bulkUpdateVms: (body: { ids?: string[]; filters?: Record<string, unknown>; patch: Record<string, unknown> }) =>
    apiRequest<{ updated: number; failed: { id: string; message: string }[] }>('/vms/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
```

- [ ] **Step 6: Wire selection mode into the page**

In `InventoryPage.tsx`, add beside the selection state:

```tsx
  // 'ids' = the checkboxes on this page. 'filters' = every row matching the
  // current filter set, which may span pages the user has never rendered.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | undefined>();
  const queryClient = useQueryClient();

  const pageFullySelected = items.length > 0 && selectedIds.size === items.length;
  const targetCount = selectAllMatching ? total : selectedIds.size;
  const targetLabel = selectAllMatching
    ? `all ${total.toLocaleString()} matching VMs`
    : `${selectedIds.size} VM${selectedIds.size === 1 ? '' : 's'}`;

  function bulkFilters(): Record<string, unknown> {
    const active = filtersFromParams(searchParams);
    const payload: Record<string, unknown> = {};
    for (const name of filterNames) {
      if (active[name].length === 0) continue;
      payload[name] = name === 'q' ? active[name][0] : active[name];
    }
    return payload;
  }

  const bulkMutation = useMutation({
    mutationFn: (patch: BulkPatch) =>
      api.bulkUpdateVms(
        selectAllMatching ? { filters: bulkFilters(), patch } : { ids: [...selectedIds], patch },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      setBulkOpen(false);
      setSelectedIds(new Set());
      setSelectAllMatching(false);
      setBulkError(
        result.failed.length > 0
          ? `${result.updated} updated, ${result.failed.length} failed`
          : undefined,
      );
    },
    onError: (error) => setBulkError(detailMessage(error)),
  });
```

Import `useMutation`, `useQueryClient` from `@tanstack/react-query`, plus `BulkEditDrawer` and its `BulkPatch` type. Reset `selectAllMatching` wherever `setSelectedIds(new Set())` already runs.

In the bulk bar, replace the count span and add the two new controls:

```tsx
            <span className="text-sm font-semibold tabular-nums">
              {selectAllMatching ? `All ${total.toLocaleString()} matching filters` : `${selectedIds.size} selected`}
            </span>
            {!selectAllMatching && pageFullySelected && total > items.length && (
              <button type="button" onClick={() => setSelectAllMatching(true)} className="text-sm font-medium text-white/90 hover:text-white transition-colors">
                Select all {total.toLocaleString()} matching filters
              </button>
            )}
            <button type="button" onClick={() => { setBulkError(undefined); setBulkOpen(true); }} className="text-sm font-medium text-white/90 hover:text-white transition-colors">
              Edit
            </button>
```

Render the drawer next to the bar, and gate `Edit` on `canCreateVm` (the same editor/admin rule the page already computes):

```tsx
      <BulkEditDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        targetLabel={targetLabel}
        onSubmit={(patch) => bulkMutation.mutate(patch)}
        pending={bulkMutation.isPending}
        error={bulkError}
      />
```

The bulk bar's visibility condition becomes `selectedIds.size > 0 || selectAllMatching`, and `targetCount` guards the drawer against a zero-target apply.

- [ ] **Step 7: Extend the page test**

```tsx
  it('sends ids when editing a page selection', async () => {
    renderInventory();
    await userEvent.click(await screen.findByLabelText('Select vm-01'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to 1 VM$/ }));

    expect(vi.mocked(api.bulkUpdateVms)).toHaveBeenCalledWith({
      ids: ['vm-01-id'],
      patch: { status: 'running' },
    });
  });

  it('sends filters after selecting everything matching', async () => {
    renderInventory();
    await userEvent.click(await screen.findByLabelText('Select all'));
    await userEvent.click(screen.getByRole('button', { name: /Select all .* matching filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'high');
    await userEvent.click(screen.getByRole('button', { name: /^Apply to all/ }));

    const body = vi.mocked(api.bulkUpdateVms).mock.calls.at(-1)![0];
    expect(body.ids).toBeUndefined();
    expect(body.patch).toEqual({ criticality: 'high' });
  });
```

The second test needs the `listVms` mock to return a `total` greater than `items.length` so the "select all matching" affordance renders.

- [ ] **Step 8: Run tests**

Run: `cd frontend && npx vitest run`
Expected: PASS with coverage at or above 80% on all four metrics. If branch coverage dips, cover the `failed.length > 0` alert path in `InventoryPage.test.tsx`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/BulkEditDrawer.tsx frontend/src/api/client.ts frontend/src/routes/InventoryPage.tsx frontend/src/test/BulkEditDrawer.test.tsx frontend/src/test/InventoryPage.test.tsx
git commit -m "feat(inventory): bulk edit drawer with cross-page selection"
```

---

### Task 10: E2E coverage and the full gate

**Files:**
- Modify: `frontend/e2e/inventory.spec.ts`
- Test: the whole suite via `just verify`

**Interfaces:**
- Consumes: everything from Tasks 1–9. Produces no new module surface.

- [ ] **Step 1: Add the E2E cases**

Append to `frontend/e2e/inventory.spec.ts`, following the file's existing `loginAsAdmin` / `setupInitialAdmin` helpers:

```ts
test('pages through the inventory and changes rows per page', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/inventory');

  await page.getByLabel('Rows per page').selectOption('25');
  await expect(page).toHaveURL(/size=25/);

  const firstName = await page.locator('[data-testid="cell-name"]').first().innerText();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('[data-testid="cell-name"]').first()).not.toHaveText(firstName);
});

test('bulk edits the selected rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/inventory');

  await page.getByLabel('Select all').check();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Criticality').selectOption('high');
  await page.getByRole('button', { name: /^Apply to/ }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('[data-testid="cell-criticality"]').first()).toHaveText(/high/i);
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `just e2e` (or the project's Playwright command in `justfile`)
Expected: PASS. If Playwright cannot launch, see `reports/visual-report.md` — missing browser system libraries are a known local failure, not a code failure.

- [ ] **Step 3: Run the full gate**

Run: `just verify`
Expected: ruff clean, mypy clean, pytest green, Vitest green at ≥80% coverage, Playwright green.

- [ ] **Step 4: Run the design detector on the changed UI**

Run:
```bash
node /home/tejas/.claude/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/components/PaginationFooter.tsx \
  frontend/src/components/BulkEditDrawer.tsx \
  frontend/src/routes/InventoryPage.tsx
```
Fix any reported finding that is a real violation of DESIGN.md (saturated color on chrome, resting shadows, a second left-border accent).

- [ ] **Step 5: Update the docs that describe these surfaces**

- `docs/CONTRIBUTING.md`: nothing to change unless a `just` target moved (its marked sections are generated from source).
- `README.md`: if it documents the CSV columns or the export, add `vm_type`, `applications`, the extended disk/IP cell formats, and the `format=xlsx` option.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/inventory.spec.ts README.md
git commit -m "test(e2e): page-through and bulk edit coverage"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1 Backend sort + paginate | Task 1 |
| 2 Frontend pagination controls | Task 2 |
| 3 Import full field parity | Tasks 3, 4, 5 |
| 4 Export all fields + xlsx | Tasks 6, 7 |
| 5 Bulk edit endpoint | Task 8 |
| 5 Bulk edit UI + cross-page selection | Task 9 |
| Testing section | Tasks 1–9 inline, plus Task 10 |

**Known deviation from the spec:** the API sort key is `health` (the existing
table column key) rather than `health_score`; `SORT_COLUMNS["health"]` maps to
`Vm.health_score`. One key, one list, no drift — the spec's intent, with the
column key winning.

**Type consistency check:** `_parse_disks` widens to a 4-tuple in Task 5, and
all three call sites (`normalize_csv_row`, `_attach_children`,
`diff_against_vm`) are updated in that same task. `_export_row` (Task 6) is
consumed unchanged by `_xlsx_response` (Task 7). `BulkPatch` is defined in
`BulkEditDrawer.tsx` and imported by `InventoryPage.tsx`; `bulkUpdateVms`
accepts `Record<string, unknown>` for `patch`, which `BulkPatch` satisfies.
`VmBulkFilters.status` maps to `apply_vm_filters(status_value=...)`, renamed
explicitly in `_resolve_targets`.
