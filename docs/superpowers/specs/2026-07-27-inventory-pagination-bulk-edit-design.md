# Inventory Pagination, Full-Field Import/Export, Bulk Edit

**Date:** 2026-07-27
**Status:** Design — awaiting review

## Problem

Four gaps on the inventory surface:

1. **No pagination.** `GET /api/vms` already accepts `limit` (1–200, default 50)
   and `offset`, but `InventoryPage` never sends them. Users see the first 50
   rows with no way to reach row 51 and no control over page size.
2. **Import field gaps.** `csv_import.py` derives `OPTIONAL_HEADERS` from
   `VmBase.model_fields`, so every scalar VM field is already importable. What
   is genuinely missing: `vm_type` (hard-excluded), `applications` (no column at
   all), and child detail — disks parse only `name:size`, IPs carry only an
   address.
3. **Export field gaps.** `_EXPORT_COLS` is a hand-maintained 22-column subset
   of a ~35-column model, and it is CSV-only.
4. **No bulk edit.** The bulk action bar offers Export and Clear only; changing
   status/owner/tags on 40 VMs means 40 visits to the edit form.

## Key findings

- **Pagination is mostly frontend.** The backend contract exists; only sorting
  must move server-side (see below).
- **Sorting is client-side today** (`sortValue` over `vms.data.items` in
  `InventoryPage.tsx`). The moment pages exist, a column sort would reorder only
  the visible 50 rows — a sort that looks broken. Sorting must move into SQL.
- **`_EXPORT_COLS` contains two phantom columns.** It lists `vcpu` and
  `memory_gb`; the model fields are `cpu_cores` and `memory_mb`. Because the
  writer uses `getattr(vm, col, None)`, both columns ship silently empty in
  every export today. This is an existing bug the full-field rewrite fixes.
- **`health_score` is denormalized** on the `Vm` row, so any bulk mutation must
  go through `services/vms.py::update_vm`, which already writes audit rows and
  calls `recompute_health`. Bulk edit must not bypass it.

## Design

### 1. Backend — sort + paginate (`api/routes/vms.py`, `services/vms.py`)

`list_inventory` gains `sort` and `dir` query params; `list_vms` gains matching
arguments and builds the `ORDER BY`.

Sortable keys (whitelist; anything else → 422 via the `Query(pattern=…)`
constraint already used for `health`):

`name`, `status`, `criticality`, `health`, `updated_at`, `cluster`,
`platform`, `environment`, `lifecycle`, `cpu_cores`, `memory_mb`, `owner`.

- `dir` is `asc` | `desc`, default `asc`. Default sort stays the current
  `updated_at DESC, name ASC` when no `sort` is supplied.
- **`Vm.name.asc()` is always appended as the final tie-break.** Without a total
  order, Postgres may repeat or skip rows between pages.
- `criticality` sorts by severity, not alphabetically (`critical` > `high` >
  `medium` > `low`), via an explicit `case()` mapping. Same treatment for
  `status`, which otherwise sorts `archived` before `running`. Other enums sort
  on their stored value.
- `limit` keeps its `le=200` ceiling. Page sizes offered: 25 / 50 / 100 / 200.
  Exporting is the path for "all rows".
- The table's existing `health` column key maps to the `health_score` sort key;
  `SORTABLE_COLUMNS` in `InventoryPage.tsx` is replaced by this whitelist so the
  two lists cannot drift.

### 2. Frontend — pagination controls (`routes/InventoryPage.tsx`)

**State lives in the URL**, alongside the existing filter params: `page`, `size`,
`sort`, `dir`. This matches the established `paramsFromFilters` /
`filtersFromParams` pattern, keeps deep links and browser Back correct, and
gives react-query a distinct cache key per page for free.

- `paramsFromFilters` extends to emit `limit`/`offset` derived from `page`+`size`.
- Client-side `sortValue`, `sortKey`, `sortDir` state is **deleted**. `onSort`
  pushes `sort`/`dir` into the URL; `SortIcon` reads from URL state.
- Changing a filter or the page size resets to page 1. An `offset` beyond
  `total` clamps to the last page rather than rendering an empty table.

**Pagination footer** — rendered under both the `lg:` table and the mobile card
grid:

- Left: `51–100 of 3,412`, tabular-nums (the Tabular Rule in DESIGN.md).
- Right: native `<select>` labelled `Rows` (`selectClass`, which already carries
  the `app-select` treatment) · `Prev` / `Next` · `Page 3 of 69`.
- Prev/Next disabled at the bounds; both carry `aria-label`s. The
  `Page X of Y` text sits in an `aria-live="polite"` region so screen-reader
  users hear page changes.
- No numbered page strip. Fleet sizes here are hundreds of records; Prev/Next
  plus the range readout is quieter and matches "quiet by default".
- The control is chrome, not data, so it stays neutral — no semantic color
  (the Signal Rule).

Page size is remembered in `localStorage`.
`ponytail:` ceiling — move to the user-preferences JSONB (as
`useColumnPreferences` does) if it needs to follow an account across devices.

### 3. Import — full field parity (`services/csv_import.py`)

| Gap | Change |
|---|---|
| `vm_type` | Remove from `EXCLUDED_FROM_CSV`, add to `ENUM_HEADERS`. It flows through `_apply_vm_type_lifecycle` exactly as the VM form does — importing `temporary` gates lifecycle identically. |
| `applications` | New child column, `name:owner;name:owner` (owner optional). Attached in `_attach_children`, additive like disks/IPs, deduped on the existing `uq_vm_applications_vm_app` constraint. |
| Disk detail | `_parse_disks` accepts `name:size[:storage_name[:storage_type]]`. |
| IP detail | Role columns accept `address[:vlan[:gateway]]`. |

All extensions are supersets: the existing two-part disk cell and bare IP
address keep parsing unchanged, so previously valid CSVs stay valid.

`download_template` derives its header row from `ALL_HEADERS`, so it picks up
the new columns automatically — asserted by test rather than assumed.

Preview (`diff_against_vm`) reports the new scalar fields like any other; child
additions keep their current "unchanged action, change columns" treatment.

### 4. Export — all fields, CSV default, xlsx opt-in (`api/routes/vms.py`)

- `_EXPORT_COLS` is replaced with the full ordered list of `Vm` scalar columns,
  correcting `vcpu` → `cpu_cores` and `memory_gb` → `memory_mb`, and adding the
  fields the current list omits: `external_id`, `datacenter`, `sr_id`,
  `os_name`, `lifecycle`, `vm_type`, `backup_enabled`, `backup_location`,
  `ha_enabled`, `security_remarks`, `last_verified_at`, `health_score`,
  `created_at`, `updated_at`.
- Child columns (`disks`, the IP-role columns, `applications`) are emitted in
  **exactly the shapes the importer accepts**, so export → import round-trips
  without loss.
- New `format` query param, `csv` (default) | `xlsx`.
  - CSV path is unchanged in mechanism: streaming `csv.DictWriter`.
  - xlsx path uses **`xlsxwriter`** (new backend dependency) in
    `constant_memory=True` mode so rows stream to the buffer instead of
    accumulating a full workbook object. Bold frozen header row, autofilter,
    sized columns; dates written as real dates, booleans as TRUE/FALSE, integers
    as numbers rather than text.
  - Content-Disposition filename and media type switch with the format.
- Frontend: the header action becomes two plain links, `Export CSV` and
  `Export Excel`, both carrying the current filter params. The bulk bar's
  `Export` gains the same pair. No popover component is invented for two items.

### 5. Bulk edit

**Endpoint:** `POST /api/vms/bulk` — `EditorUser` + `Csrf`. (Every
state-changing route must declare `Csrf`; omitting it silently disables CSRF for
that endpoint.)

```
{ "ids": ["uuid", ...] | null,
  "filters": { ...VmFilterParams... } | null,
  "patch": { ...VmBulkUpdate... } }
```

- Exactly one of `ids` / `filters` — a model validator rejects both-or-neither.
  This mirrors the `/vms/export` contract, which already accepts `ids` or the
  filter set, so the two bulk surfaces resolve their target set the same way.
- `filters` mode resolves through the same `apply_vm_filters` used by list and
  export, so "everything matching what I'm looking at" cannot drift from what
  the table shows.
  `filters` is a JSON object mirroring the `VmFilterParams` fields (a Pydantic
  model with the same names, since the body cannot reuse the query dataclass).
- **Cap: 1000 VMs per request**, counted before mutating; over the cap returns
  422 with the count. Protects against a mis-set filter rewriting the fleet.
- `VmBulkUpdate` schema — classification, ownership, flags only:
  `status`, `environment`, `criticality`, `lifecycle`, `vm_type`, `cluster`,
  `node`, `datacenter`, `owner`, `business_owner`, `technical_owner`,
  `pmp_enabled`, `monitoring_enabled`, `backup_enabled`, `ha_enabled`,
  `backup_location`, `last_verified_at`, plus `tags_add` / `tags_remove`.
  - Identity fields (`name`, `fqdn`, `external_id`, `sr_id`) are excluded: they
    are per-VM unique and bulk-setting them collides.
  - Tags are **add/remove, never replace** — a replace across 50 VMs destroys
    per-VM tags with no undo.
  - Only supplied keys apply (`exclude_unset`), so an omitted field means
    "leave alone", the same contract the importer uses.
  - When a patch sets both `vm_type` and `lifecycle`, `_apply_vm_type_lifecycle`
    wins, exactly as it does on the single-VM form. The drawer states this next
    to the `vm_type` field rather than letting the result look arbitrary.
- Each VM is updated through `services/vms.py::update_vm`, preserving the
  per-field audit rows and the `recompute_health` invariant.
- **Partial success:** rows that succeed commit; failures are collected and
  returned as `{ "updated": n, "failed": [{"id": ..., "message": ...}] }`.
  An all-or-nothing rollback would let one bad row waste a 900-VM operation.

**UI** (`InventoryPage.tsx` bulk bar + new `BulkEditDrawer.tsx`):

- The bulk bar gains **Edit**, opening the existing `Drawer` component — the
  same right-side overlay already used for Filters and Columns. No modal, no
  modal-on-modal, no wizard.
- Every field renders in a "leave unchanged" state; only fields the user
  actually touches are sent. The drawer groups them the way the filter drawer
  groups its own: Classification / Ownership / Flags / Tags.
- Footer: `Apply to 12 VMs` (primary) + `Cancel`. The count in the button label
  **is** the confirmation — DESIGN.md forbids adding a confirmation dialog where
  none exists today.
- On success: invalidate `['vms']`, surface `N VMs updated` via the existing
  `Alert`, clear the selection, close the drawer. Partial failures list the
  failed VM names in the same alert.

**Cross-page selection:** the bulk bar tracks a selection *mode*, not just an id
set:

- `ids` mode — the current behaviour, checkboxes on the visible page.
- `filters` mode — when every row on the page is selected and `total` exceeds
  the page size, the bar offers `Select all 3,412 matching filters`. Choosing it
  switches to `filters` mode and sends the filter params instead of ids.
- The bar always states which mode is active (`12 selected` vs
  `All 3,412 matching filters`) so a bulk edit can never silently apply to more
  rows than the user believes. Clearing returns to `ids` mode.

## Testing

Backend (`pytest`, real Postgres):

- Page boundaries are stable under each sortable key — page 1 + page 2 contain
  no duplicates and cover the full set.
- `criticality` and `status` sort by severity/declaration order, not
  alphabetically. Unknown `sort` value → 422.
- Import: `vm_type` sets lifecycle gating; `applications` column creates child
  rows and is idempotent on re-import; extended disk and IP cells parse, and the
  short forms still parse; template header row contains every importable column.
- Export: CSV contains every model field with correct `cpu_cores`/`memory_mb`
  values (regression on the phantom-column bug); `format=xlsx` returns a valid
  workbook with a matching header row; a CSV export re-imports cleanly.
- Bulk: audit rows written per changed field; `health_score` recomputed;
  `tags_add`/`tags_remove` are additive/subtractive; viewer forbidden; missing
  CSRF rejected; over-cap request 422; partial failure reports per-id errors;
  `filters` mode targets the same set the list endpoint returns.

Frontend (Vitest, **80% coverage gate on lines/statements/functions/branches**):

- `InventoryPage.test.tsx`: footer renders the correct range and page count;
  changing page size resets to page 1; Prev disabled on page 1; sort click
  writes `sort`/`dir` to the URL and re-queries.
- `BulkEditDrawer.test.tsx`: untouched fields are omitted from the payload;
  tag add/remove sends `tags_add`/`tags_remove`; the apply button reflects the
  selected count; `filters` mode sends filters rather than ids.

E2E: extend `frontend/e2e/inventory.spec.ts` with a page-through and a bulk
status change.

## Out of scope / skipped

- Numbered page buttons and jump-to-page input — Prev/Next plus the range
  readout covers hundreds of records.
- A "rows: All" option — export is the path for the full set, and it avoids
  raising the backend's 200-row ceiling.
- Server-side persistence of page size (localStorage instead; ceiling noted
  above).
- Bulk **delete** — destructive, admin-only, and not requested.
- Bulk editing identity fields, CPU/RAM, or OS fields — excluded by design, not
  by omission.
- Any change to storage, cluster, dashboard, or reports surfaces.
