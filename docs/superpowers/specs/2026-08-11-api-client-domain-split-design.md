# Design: Split `frontend/src/api/client.ts` into domain modules

## Context

This is the first slice of a broader "reduce fragility / inconsistency" refactor effort, targeting the worst offenders by file size first:

1. `frontend/src/api/client.ts` (617 lines) — this spec
2. `backend/app/services/vms.py` (524 lines) — future spec
3. `frontend/src/routes/InventoryPage.tsx` (835 lines) — future spec
4. `backend/app/services/csv_import.py` (822 lines) — future spec

`client.ts` today is internally well-organized (types, then fetch helpers, then a single flat `api` object) but mixes six unrelated domains — auth/users, VMs (+ disks/networks/applications/audit), dashboard/reports, imports, storage, clusters, settings/preferences — into one file and one object. Every page imports the same monolith regardless of which domain it actually uses, and the file grows on every unrelated feature addition.

## Goal

Split `client.ts` into one file per domain, with call sites importing only what they use. No behavior change — pure structural move.

## Design

New files under `frontend/src/api/`:

- `core.ts` — `apiRequest`, `ApiError`, `detailMessage`, `parseResponse`, `readCookie`, `isStateChanging`, `API_PREFIX`, `CSRF_COOKIE`. Internal fetch/CSRF/401-refresh-retry/timeout logic, unchanged.
- `types.ts` — all interfaces and type aliases currently in `client.ts` (Vm, Disk, Network, Application, AuditLogEntry, StorageArray/Volume/Lun/NfsShare, PhysicalCluster/Node, DropdownOption(s), User, ImportBatch/Row, DashboardStats, LdapConfig, AppSettings, etc.)
- `auth.ts` — exports `auth`: `setupStatus`, `setupAdmin`, `login`, `logout`, `me`, `listUsers`, `createUser`, `updateUser`
- `vms.ts` — exports `vms`: VM CRUD, clone, bulk update, export URLs, owners/clusters/nodes/applications/tags lookups, disks/networks/applications sub-resources, audit log, decommission notifications (ack + list)
- `dashboard.ts` — exports `dashboard`: `getDashboard`, `reportUrl`, `getReportSummary`
- `imports.ts` — exports `imports`: `previewImport`, `getImport`, `commitImport`
- `storage.ts` — exports `storage`: arrays, volumes, luns, shares CRUD
- `clusters.ts` — exports `clusters`: physical clusters + nodes CRUD
- `settings.ts` — exports `settings`: dropdown options, app settings, LDAP config + test, column preferences, accent

Each domain file imports `apiRequest`/`ApiError` from `core.ts` and relevant types from `types.ts`, and exports a plain object of functions (mirrors the current method names under `api.*`, e.g. `api.listVms` → `vms.listVms`, `api.getDashboard` → `dashboard.getDashboard`). No `api.*` compat shim — call sites are updated directly.

`client.ts` is deleted once all call sites are migrated.

## Call site migration

25 files currently import from `api/client`. Each gets:
- Import statement updated to pull from the specific domain module(s) it uses (a file may need more than one, e.g. `VmDetailPage.tsx` likely needs `vms` and possibly `dashboard`).
- `api.xxx(...)` calls renamed to `domain.xxx(...)`.
- Type imports (e.g. `Vm`, `StorageArray`) updated to come from `api/types` instead of `api/client`.

This is mechanical, not a behavior change — verified by `tsc` compiling clean and existing Playwright/e2e tests passing.

## Error handling

Unchanged — `ApiError`, `detailMessage`, timeout/abort, CSRF header injection, and 401-refresh-retry logic move verbatim into `core.ts`.

## Testing

No new tests. This is a pure structural refactor:
- `tsc --noEmit` (or `next build`) catches any missed/broken import.
- Existing Playwright/e2e suite (`frontend/e2e`) exercises the actual API calls end-to-end and would catch behavior regressions.
