# FRD Gap-Closure Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Scope:** Close the gaps between the VM Inventory FRD v1.0 and the shipped MVP (commit `04cc32b`, migration `0004_frd_schema_expansion`).

## Context

The MVP already implements ~90% of the FRD: VM CRUD + clone, child entities (disks, networks, applications, attachments), the 10-card dashboard + recently-added, the full VM detail page (every §26 section), CSV import (preview/map/validate/duplicate/commit), CSV export, all 8 reports, audit log, health-score computation + display, RBAC, users, and admin-managed dropdown settings.

This design covers **only the genuine gaps**. Everything already built is out of scope. All of FRD §29 (hypervisor sync, REST API, LDAP, notifications, custom fields, etc.) is out of scope.

## Changes

### A. `VmStatus` enum fix (bug)

The frontend TS type and the inventory status dropdown already offer `archived` and `decommissioned`, but the backend `VmStatus` enum lacks them — selecting either returns HTTP 422.

- `backend/app/db/models.py`: add `archived = "archived"` and `decommissioned = "decommissioned"` to `VmStatus`. Keep existing `running`, `powered_off`, `suspended`, `unknown`.
- Alembic migration: `ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived'` and `… 'decommissioned'`. Postgres enum-extend is idempotent and must run outside a transaction block (`op.execute` with the standard alembic autocommit caveat; `ADD VALUE` cannot be used in the same transaction that later references it, so the migration only extends the type).
- §5 "Archive VM": a single PATCH `status=archived` button on the VM detail page reusing the existing update endpoint. **No new route, no soft-delete table** — the `archived`/`decommissioned` statuses already express archival.

### B. Global search §19

`apply_vm_filters` `q` currently matches `name`, `cluster`, `owner`, `fqdn`, `department`. Extend the `or_(...)` to also match:

- VM ID: `external_id`, `sr_id`
- OS: `os_name`, `os_distribution`, `os_version`
- Tags: `cast(Vm.tags, Text)` LIKE pattern (substring match across the JSONB array — imprecise but adequate; mark with a `ponytail:` comment)
- IP address: `EXISTS (SELECT 1 FROM vm_networks WHERE vm_networks.vm_id = vms.id AND ip_address LIKE :pat)`
- Application: `EXISTS (SELECT 1 FROM vm_applications WHERE vm_applications.vm_id = vms.id AND lower(app_name) LIKE :pat)`

All case-insensitive (`func.lower(...)`). `EXISTS` subqueries avoid row duplication that a join would cause.

### C. Filters §20

Add backend filter params to `apply_vm_filters` and the `list_inventory` endpoint: `node`, `os_family`, `owner`, `department`, `tag`, `application`.

- `node`, `owner`, `department` → equality on the respective `Vm` column
- `os_family` → `Vm.os_family == os_family`
- `tag` → `Vm.tags.contains([tag])` (JSONB `@>`)
- `application` → `EXISTS` on `vm_applications.app_name`

Each adds an `AND` WHERE, so filters combine (FRD "multiple filters work together").

UI (`InventoryPage.tsx`): `os_family` and `owner` as dropdowns (`owner` reuses the existing `/vms/owners` endpoint); `cluster`, `node`, `department`, `tag`, `application` as free-text inputs. **No new distinct-value endpoints** — free-text avoids 5 extra routes.

### D. Health score → persisted column

`health_score` is currently a Python `@property`, so it cannot be filtered in SQL. Persist it (decision A from approval).

- `Vm` gains an indexed `health_score: Mapped[int]` column (default 0).
- Extract the current `@property` body into a module-level `compute_health_score(vm)` function. Add a `recompute_health(db, vm)` service helper that sets `vm.health_score = compute_health_score(vm)`.
- Call `recompute_health` at every mutation site: `create_vm`, `update_vm`, `clone_vm`, and disk/network/application add + delete (~8 sites, one helper). At these sites the VM and its collections are loaded.
- Migration: add the column, then backfill via a SQL `CASE` expression replicating the scoring weights (one-time; runtime keeps it fresh, so no ongoing drift).
- New filter param `health` ∈ `below_50 | below_75 | complete` → `WHERE health_score < 50 | < 75 | = 100` (weights sum to 100). Added to `apply_vm_filters`, `list_inventory`, and a UI dropdown.
- `to_vm_read` drops its `model_copy(update={"health_score": ...})` override — `VmRead` reads the column directly.
- Render the score as a small badge in inventory list rows so the filter has visible meaning.

Scoring weights (unchanged from the existing property): description 10, any owner 15, applications 20, networks 15, disks 15, monitoring 10, decommission_date 15 = 100.

### E. Export honors filters + selected IDs §22

- `export_vms` accepts the same filter query params as `list_inventory` (reuse `apply_vm_filters`) plus optional repeated `ids` query params. If `ids` present → `WHERE id IN ids`; else apply filters. Output stays CSV (no `openpyxl`).
- `InventoryPage.tsx`: row checkboxes + an "Export selected" button (sends checked `ids`) and an "Export filtered" button (sends the active filter params). The existing Reports "Export all VMs" button is unchanged (no params = all).

### F. Verification

Backend pytest (extend `backend/tests/test_auth_rbac_vms.py` or a focused new module):

- A: create + list a VM with `status=archived` round-trips (was 422 before).
- B: search `q` matches by IP address, application name, tag, and VM ID.
- C: each new filter (`node`, `os_family`, `owner`, `department`, `tag`, `application`) narrows results; two combined filters AND correctly.
- D: adding a disk/network/application recomputes the stored `health_score`; each `health` band (`below_50`, `below_75`, `complete`) returns the right set; backfill migration value matches `compute_health_score`.
- E: export with active filters returns only matching rows; export with `ids` returns exactly those rows.

Frontend: one `clientBehavior` test asserting the new filter params serialize into the list query string.

Final gate: `just verify` (lint + typecheck + tests, both stacks).

## Explicitly skipped (YAGNI / ponytail)

- Native `.xlsx` export — CSV opens natively in Excel; adds an `openpyxl` dependency for no functional gain.
- Soft-delete table — `archived`/`decommissioned` statuses cover archival; hard delete stays for true removal.
- Card/table view toggle — the inventory page already switches table↔card responsively.
- Per-filter distinct-value endpoints — free-text inputs cover `cluster`/`node`/`department`/`tag`/`application`.

## Touched files

- `backend/app/db/models.py` — `VmStatus` values, `Vm.health_score` column, extract `compute_health_score`.
- `backend/alembic/versions/0005_*.py` — enum extend + health_score column + backfill.
- `backend/app/services/vms.py` — `apply_vm_filters` (search + filters + health band), `recompute_health`, mutation-site calls, `to_vm_read`.
- `backend/app/services/` disks/networks/applications — `recompute_health` calls.
- `backend/app/api/routes/vms.py` — `list_inventory` + `export_vms` query params.
- `frontend/src/routes/InventoryPage.tsx` — new filter controls, health badge, selection + export buttons.
- `frontend/src/api/client.ts` — list/export param types, `health` filter type.
- `backend/tests/…`, `frontend/src/test/clientBehavior.test.ts` — coverage.
