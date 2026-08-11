# Remove lifecycle field; exclude Template-tagged VMs from alerts and health scoring

## Problem

1. `lifecycle` is a legacy required enum field (`planned`/`active`/`retiring`/`retired`) on `Vm`, with auto-set logic tied to `vm_type`. It is no longer wanted and should be removed end-to-end.
2. Dashboard alerts and health scoring currently treat template VMs (tagged `Template`/`template`) the same as real VMs, producing noise: templates show up in "stale/missing IP/decommission overdue" lists and drag down health-score-based views even though they aren't real inventory.

## Goals

- Fully remove the `lifecycle` field: DB column, backend model/schema/filter/CSV-import/report/preferences code, frontend forms/filters/columns/tests.
- Exclude VMs tagged `Template` (case-insensitive) from:
  - All three dashboard alert lists (`shutdown_stale`, `decommission_overdue`, `missing_ip`).
  - Dashboard summary counts (`without_monitoring`, `without_applications`, and other stat counts).
  - Health score: `compute_health_score` returns `0` for Template-tagged VMs, and the `health=below_50|below_75|complete` list filter excludes them.

## Non-goals

- Not changing `decommission_date` or the underlying "Lifecycle Report" data (still sorted by `decommission_date`) — only its key/label change.
- Not introducing a general-purpose "excluded tags" config; hardcode to `Template` only (previous `backup` exclusion is dropped, since it was never requested and conflated two unrelated concerns).
- Not changing health score weighting/formula for non-template VMs.

## Design

### 1. Remove `lifecycle` field

- **Migration**: new Alembic revision dropping `ix_vms_lifecycle` index, the `lifecycle` column, and the `lifecycle` Postgres enum type.
- **`backend/app/db/models.py`**: remove `lifecycle` column, `Lifecycle` enum (if unused elsewhere — check), and `ix_vms_lifecycle` index declaration.
- **`backend/app/services/vms.py`**: delete `_apply_vm_type_lifecycle` and its two call sites; remove `lifecycle` from filter param list, filter map (`FILTER_MAP`-equivalent at line ~392), and sort/column map (line ~489).
- **`backend/app/schemas/vms.py`**: remove `lifecycle` from `VmCreate`, `VmUpdate`, `VmRead`, `VmFilter` (lines ~71, 86, 122, 294, 322).
- **`backend/app/services/csv_import.py`**: remove `lifecycle` from the classification column group, `ENUM_HEADERS`, per-vm_type default values (`"active"`/`"retiring"`), and the allowed-values set.
- **`backend/app/api/routes/preferences.py`**: remove the `lifecycle` default column-visibility entry.
- **`backend/app/api/routes/reports.py`**: rename the `"lifecycle"` report key to `"decommission"`, label "Lifecycle Report" → "Decommission Report"; filter logic (`order_by(Vm.decommission_date.asc())`) unchanged.
- **Frontend**: remove `lifecycle` from VM form (`VmFormPage.tsx`, `lib/vmForm.ts`), filters (`filterConfig.ts`), column preferences (`useColumnPreferences.ts`), CSV import mapping (`ImportCsvPage.tsx`), API client types (`api/client.ts`), and any UI referencing it (`InventoryPage.tsx`, `VmDetailPage.tsx`, `ReportsPage.tsx`, `BulkEditDrawer.tsx`, `LoginPage.tsx` if applicable). Update affected tests (`filterConfig.test.ts`, `apiClient.test.ts`, `VmDetailPage.test.tsx`, `test/utils.tsx`).
- Update `sample-import.csv` to drop the `lifecycle` column if present.

### 2. Template-tag exclusion

- Add a small shared helper, e.g. in `backend/app/services/vms.py`:
  ```python
  def is_template(vm_or_tags) -> bool: ...
  ```
  or a reusable SQL condition for use in dashboard queries (preferred over per-row Python filtering, so summary counts and `LIMIT`-based lists aren't undercounted after filtering).
- **`backend/app/db/models.py`**: `compute_health_score` checks tags first; if `"template"` present (case-insensitive), return `0` immediately, skipping the rest of the scoring logic.
- **`backend/app/api/routes/dashboard.py`**:
  - Replace the ad-hoc `EXCLUDED_TAGS = {"template", "backup"}` Python-side filtering with a single SQL-level condition (e.g. `~Vm.tags.contains(["template"])`, applied case-insensitively) reused across all queries: `shutdown_stale`, `decommission_overdue` (currently missing exclusion), `missing_ip`, and the summary aggregate query (`without_monitoring`, `without_applications`, and other `case()` counts, plus `total`/`by_status`/etc. — apply exclusion to the whole base query since templates shouldn't count as real inventory anywhere on this dashboard).
- **VM list health filter** (`services/vms.py`, `health` query param handling): when filtering `health=below_50` etc., exclude Template-tagged VMs from the result set (they're always `0` post-change, so `below_50` would otherwise wrongly include every template — must be excluded, not just scored 0).

## Testing

- Backend: update/add tests in `test_csv_imports.py`, `test_vm_export.py`, `conftest.py` fixtures (currently set `lifecycle` on created VMs — remove). Add a test asserting `compute_health_score` returns `0` for a Template-tagged VM, and dashboard alert/summary endpoints exclude Template-tagged VMs.
- Frontend: update snapshot/unit tests that reference `lifecycle` fields or options.
- Migration: verify `alembic upgrade head` / `downgrade -1` round-trips cleanly against a seeded dev DB.
