# Storage Array Tracking — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Track Synology and NetApp NAS/SAN arrays that back the Proxmox and VMware
environments: overall storage usage, the iSCSI LUNs provisioned to hypervisor
clusters, and the active NFS shares. Pure **documentation inventory** — the
arrays are never contacted; every value is user-entered (consistent with the
existing VM inventory domain).

## Decisions (from brainstorm)

| Question | Decision |
|----------|----------|
| Live polling vs documentation | **Documentation only.** No connection to arrays. |
| LUN linkage | Linked to a **hypervisor cluster** (governed value). |
| Cluster tracking | **Managed value list** (new dropdown category), not a rich entity. |
| Hierarchy depth | **Three levels:** Array → Volume → LUN / NFS Share. |
| CSV import | **No.** Manual UI entry only in v1. |
| Monitoring | **Current snapshot + threshold flagging.** No history. |

## Data model

Four new tables following the existing `Vm → disks/networks` parent-child
pattern (cascade delete, `sort_order` on children).

### `storage_arrays` (top-level, like `vms`)
- `id` UUID PK
- `name` — required, non-empty
- `vendor` — enum `{synology, netapp}` (fixed; adding a vendor = migration)
- `model` — text, optional
- `mgmt_host` — text, optional (IP/hostname, documentation only)
- `datacenter` — text, optional
- `description` — text, optional
- `total_capacity_gb` — int
- `used_capacity_gb` — int
- `notes` — text, optional
- `created_at` / `updated_at`, `created_by_id` / `updated_by_id`

### `storage_volumes` (child of array)
- `id` UUID PK
- `array_id` FK → `storage_arrays.id` ON DELETE CASCADE
- `name` — required
- `capacity_gb` — int
- `used_gb` — int
- `notes` — text, optional
- `sort_order` — int

### `storage_luns` (child of volume)
- `id` UUID PK
- `volume_id` FK → `storage_volumes.id` ON DELETE CASCADE
- `name` — required
- `size_gb` — int
- `used_gb` — int, optional
- `target_iqn` — text, optional
- `cluster` — text, governed by the new `cluster` dropdown category
- `status` — text (governed value), optional
- `sort_order` — int

### `storage_nfs_shares` (child of volume)
- `id` UUID PK
- `volume_id` FK → `storage_volumes.id` ON DELETE CASCADE
- `export_path` — required
- `used_gb` — int, optional
- `allowed_clients` — text, optional
- `notes` — text, optional
- `sort_order` — int

### Cluster (managed value)
- New `DropdownCategory.cluster` value.
- Migration seeds it from existing distinct `Vm.cluster` strings.
- LUNs pick a cluster from this governed list.
- `Vm.cluster` stays a `String` — **no VM schema change**.

### Usage % and threshold
- Used% computed in the **service layer** (`used / capacity`), **not stored**.
- Global warning threshold stored as an `AppSetting`:
  `storage_usage_warn_pct`, default `85`.
- Threshold flag surfaces at **array** and **volume** level.
- Capacity numbers are entered directly at each level — **not** auto-rolled-up
  from children (documentation, not computed).

### Not denormalized
No `health_score` equivalent. Used% is computed on read, so there is nothing to
keep in sync (simpler than the VM `recompute_health` invariant).

## Backend API (`api/routes/storage.py`)

RBAC ladder: `ViewerUser` read, `EditorUser` write. **Every mutating route takes
`Csrf`** (auth invariant — omitting it silently disables CSRF).

Array routes:
- `GET /api/storage/arrays` — list + summary (capacity, used%, volume/LUN/share
  counts, `over_threshold` bool)
- `POST /api/storage/arrays` — create (Editor + Csrf)
- `GET /api/storage/arrays/{id}` — detail, nested volumes → LUNs + shares
- `PATCH /api/storage/arrays/{id}` — partial update
- `DELETE /api/storage/arrays/{id}` — cascade

Child routes via a subrouter factory (same shape as
`_vm_subrouter.py::make_vm_subrouter`, minus the health recompute):
- `/arrays/{id}/volumes`, `PATCH`/`DELETE /volumes/{vid}`
- `/volumes/{vid}/luns`, `PATCH`/`DELETE /luns/{lid}`
- `/volumes/{vid}/shares`, `PATCH`/`DELETE /shares/{sid}`

Service (`services/storage.py`): CRUD + `compute_usage(array)` returning
per-array and per-volume used% and threshold flag (reads
`storage_usage_warn_pct`).

Schemas (`schemas/storage.py`): Pydantic create/update/read per entity; nested
read for the detail endpoint.

## Frontend (`frontend/src`)

- Pages are thin `src/app/**` shells re-exporting `src/routes/*.tsx`.
- All HTTP via `src/api/client.ts` (never `fetch` from a component).
- 80% Vitest coverage on lines/statements/functions/branches.

Screens:
- **Nav** — new "Storage" top-level item.
- **`StorageListPage`** — array table/cards: name, vendor, used% bar, threshold
  badge (red when over threshold).
- **`StorageDetailPage`** — array header (capacity, used%), Volume panels each
  containing LUN and NFS-share sub-tables. Same panel / inline-edit shape as
  `VmDetailPage`'s disks/networks.
- **API client methods** for the storage endpoints.
- **Settings** — one field for `storage_usage_warn_pct`, beside the existing
  decommission notify-window field.
- **Dashboard** — small storage-usage summary card (count of arrays over
  threshold).

## Testing / verify

- Backend `tests/test_storage.py` (real Postgres, conftest helpers): CRUD,
  cascade delete, RBAC (viewer blocked on write), CSRF enforced, used%/threshold
  computation, cluster-dropdown seeding.
- Frontend route + client tests to 80%.
- `just verify` (full gate) before any PR.

## Out of scope (v1)

Add later if wanted:
- Live polling of Synology DSM / NetApp ONTAP APIs
- CSV import for storage entities
- Historical usage trend / time-series
- Per-field audit logging for storage (the `AuditLog` table is VM-bound)
- Rich Cluster entity (attributes, own page)
- Per-array threshold override
