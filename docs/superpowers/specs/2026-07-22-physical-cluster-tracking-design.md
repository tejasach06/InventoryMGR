# Physical Cluster Tracking — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Track physical server clusters: the nodes they contain, each node's hardware
specs (CPU, RAM, onboard storage), IP addresses, and physical location. Pure
**documentation inventory** — no live polling, no connection to hosts. Every
value is user-entered, consistent with the existing VM and storage inventory
domains.

This feature promotes the current free-text `cluster` string on `Vm` into a
rich first-class entity. VM linkage (FK from `Vm.cluster_id` to
`PhysicalCluster`) is **explicitly deferred** to a later integration phase;
clusters and VMs are independent records in v1.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Live polling vs documentation | **Documentation only.** No connection to hosts. |
| IP addresses | **Multiple per node with labels** (JSONB array `[{label, address}]`). |
| CPU/RAM/storage granularity | **Per node**, not cluster aggregate. |
| Storage tracking | **Usable capacity in GB** — not per-drive inventory. |
| RAM tracking | **Total + used GB** per node (used nullable = unknown). |
| Physical location | **Datacenter + Rack + Rack Unit** per node. |
| VM linkage | **Independent records for now.** Integration phase later. |
| Hierarchy | **Two levels: Cluster → Nodes.** No NIC sub-table (JSONB for IPs). |
| CSV import | **No.** Manual UI entry only in v1. |

## Data Model

Two new tables, mirroring the existing `StorageArray → StorageVolume` pattern.

### `physical_clusters`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String(255) NOT NULL | non-empty check constraint |
| `description` | Text nullable | |
| `notes` | Text nullable | |
| `created_by_id` | UUID FK → users | audit trail |
| `updated_by_id` | UUID FK → users | audit trail |
| `created_at` / `updated_at` | TimestampMixin | |

Location lives on each node — a cluster can span racks, so no datacenter
field at the cluster level.

### `physical_nodes`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `cluster_id` | UUID FK → physical_clusters CASCADE DELETE | |
| `name` | String(255) NOT NULL | hostname or label |
| `cpu_model` | String(255) nullable | e.g. "Intel Xeon E5-2680 v4" |
| `cpu_cores` | Integer NOT NULL default 0 | |
| `cpu_threads` | Integer NOT NULL default 0 | |
| `ram_total_gb` | Integer NOT NULL default 0 | |
| `ram_used_gb` | Integer nullable | nullable = unknown/not tracked |
| `storage_usable_gb` | Integer NOT NULL default 0 | |
| `datacenter` | String(255) nullable | |
| `rack` | String(100) nullable | e.g. "Rack 12" |
| `rack_unit` | String(50) nullable | e.g. "U4" or "U4–U7" |
| `ip_addresses` | JSONB NOT NULL default `[]` | `[{label: str, address: str}]` |
| `notes` | Text nullable | |
| `sort_order` | Integer NOT NULL default 0 | ordering within cluster |

**Constraints:**
- `ck_physical_clusters_name_nonempty`: `length(btrim(name)) > 0`
- `ck_physical_nodes_name_nonempty`: `length(btrim(name)) > 0`
- `ck_physical_nodes_cpu_cores_nonnegative`: `cpu_cores >= 0`
- `ck_physical_nodes_cpu_threads_nonnegative`: `cpu_threads >= 0`
- `ck_physical_nodes_ram_total_nonnegative`: `ram_total_gb >= 0`
- `ck_physical_nodes_storage_nonnegative`: `storage_usable_gb >= 0`

**Alembic migration:** new migration adding both tables; no changes to existing tables in v1.

## API

Follows the storage arrays API pattern exactly.

### Cluster endpoints (`/api/clusters/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/clusters/` | all | List all clusters with nodes inline |
| POST | `/api/clusters/` | editor+ | Create cluster |
| GET | `/api/clusters/{id}` | all | Single cluster with nodes |
| PUT | `/api/clusters/{id}` | editor+ | Update cluster |
| DELETE | `/api/clusters/{id}` | editor+ | Delete cluster + cascade nodes |

### Node endpoints (nested)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/clusters/{cluster_id}/nodes/` | editor+ | Add node |
| PUT | `/api/clusters/{cluster_id}/nodes/{node_id}` | editor+ | Update node |
| DELETE | `/api/clusters/{cluster_id}/nodes/{node_id}` | editor+ | Delete node |

**RBAC:** viewers read-only; editors and admins write — identical to storage.

### Pydantic schemas

- `NodeIpAddress` — `{label: str, address: str}`
- `PhysicalNodeCreate` / `PhysicalNodeRead` / `PhysicalNodeUpdate`
- `PhysicalClusterCreate` / `PhysicalClusterRead` (includes `nodes: list[PhysicalNodeRead]`) / `PhysicalClusterUpdate`

## Frontend

### Routes

| Path | Component | Notes |
|---|---|---|
| `/clusters` | `ClustersPage` | List page |
| `/clusters/[id]` | `ClusterDetailPage` | Detail page |

No separate create route — cluster creation via modal (same as storage).

### `/clusters` list page

- Table columns: Name, Node Count, Total RAM GB (aggregate), Total Storage GB (aggregate), Description
- "New Cluster" button (editor+) opens modal — name, description, notes fields
- Row click navigates to detail page
- Viewer role: no create/edit/delete controls

### `/clusters/[id]` detail page

- Cluster header: name, description, notes; Edit button (editor+)
- Nodes table columns: Name, IPs, CPU Model, Cores / Threads, RAM (used / total GB), Storage (GB), Location (datacenter / rack / U)
- IP addresses rendered as badge list: `mgmt 10.0.1.5`, `IPMI 10.0.1.6`
- RAM used/total shown as `used / total GB` with subtle progress bar when used is set — same visual as storage usage
- "Add Node" button (editor+) opens inline form or modal
- Each node row: Edit + Delete actions (editor+)

### Navigation

New "Clusters" nav item added to `AppNav` in `buildNavItems`, between Storage and Import. Uses a new server/cluster icon.

### API client

New `ClustersClient` class in `client.ts` following the existing `StorageClient` pattern. Methods: `list`, `get`, `create`, `update`, `delete`, `createNode`, `updateNode`, `deleteNode`.

## Error Handling

| Scenario | Handling |
|---|---|
| Duplicate cluster name | `409 Conflict`; field-level error shown inline in form |
| Delete cluster with nodes | Cascade delete — nodes are owned by the cluster, no guard needed |
| Invalid IP address format | Frontend validates non-empty label + address before submit; backend accepts any string (documentation tool, not a network validator) |
| `ram_used_gb > ram_total_gb` | Backend check constraint; frontend shows warning but does not block (data may be stale) |
| Node not found | `404` with standard error response |

## Testing

- **Backend** `tests/test_clusters.py` — real Postgres via conftest: CRUD for clusters and nodes, cascade delete, RBAC (viewer blocked on write), CSRF enforced, IP address JSONB roundtrip, aggregate queries
- **Frontend** `ClusterPage.test.tsx`, `ClusterDetailPage.test.tsx` — mock API responses, render list, create/edit/delete interactions; follows `StoragePage`/`StorageDetailPage` test pattern
- `just verify` (full gate) before any PR

## Out of Scope (v1)

- VM linkage (`Vm.cluster_id` FK) — deferred to explicit integration phase
- CSV import for clusters/nodes
- Live polling / health checks against node IPs
- Historical RAM/storage usage trends
- Per-node threshold alerting
- Rich location hierarchy beyond datacenter/rack/U
