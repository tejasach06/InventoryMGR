# API Reference

All routes are mounted under `/api` (see `backend-rust/src/api/`). Auth is
JWT-in-cookie (`SESSION_COOKIE_NAME`), CSRF via `X-CSRF-Token` header for
mutating requests. Roles: `viewer` < `editor` < `admin`.

`GET /api/health` is unauthenticated and outside the versioned router (liveness
probe for Compose/Quadlet healthchecks).

## Auth — `/api/auth`

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/auth/setup` | Query initial setup status or create the first local administrator. |
| POST | `/api/auth/login` | Local credentials or LDAP bind according to the account's credential source; sets session, refresh, and CSRF cookies. Local accounts never fall back to LDAP. |
| POST | `/api/auth/refresh` | Refresh a credential-bound session; password reset invalidates the affected user's old access and refresh tokens. |
| POST | `/api/auth/logout` | Clears authentication cookies. |
| GET | `/api/auth/me` | Current authenticated user. |

Login ingress is bounded to 300 attempts/minute; account, directory lookup, and resolved-DN password-bind budgets are ten/minute. Email fields accept at most 254 bytes, passwords at most 1,024 characters. Initial and reset passwords require at least eight characters. Legacy tokens without credential binding require a fresh login after upgrade.

## Users — `/api/users`

CRUD for accounts. Admin-only for create/update/delete; role assignment is
`admin`/`editor`/`viewer`.

## VMs — `/api/vms`

| Method | Path | Notes |
|---|---|---|
| GET | `/api/vms` | List/filter VMs. |
| POST | `/api/vms` | Create. |
| GET/PATCH/DELETE | `/api/vms/{id}` | Single VM. |
| POST | `/api/vms/bulk` | Bulk edit (see `backend-rust/src/api/inventory/bulk.rs`). |
| POST | `/api/vms/bulk-delete` | Delete multiple VM inventory entries in one transaction. |

`POST /api/vms/bulk-delete` requires an admin session and a valid
`X-CSRF-Token` header. The JSON body contains an `ids` array of 1 to 200
distinct VM UUIDs and an optional `request_id` (UUID idempotency key). If
omitted, the server assigns a random UUID operation ID. The request deletes
inventory entries stored in InventoryMGR atomically.

### Idempotency, replay, and timeout semantics

- **Replay**: If a network interruption or lost response causes a client to
  retry deletion with the same `request_id`, the server verifies that the
  request originates from the same authenticated administrator and targets the
  identical set of VM UUIDs. If it matches, the server returns `204 No Content`
  without mutating database rows or generating duplicate audit events. If the
  `request_id` was previously recorded for a different user or a different set
  of VM UUIDs, the server rejects the request with `422 Unprocessable Entity`
  (`{"detail": "Deletion request could not be applied"}`).
- **Timeouts**: Row locks are acquired in sorted UUID order (`SELECT ... FOR UPDATE`)
  under a 5-second `lock_timeout`. If concurrent transactions block lock acquisition
  exceeding 5 seconds, the server aborts the transaction and returns `503 Service Unavailable`
  (`{"detail": "VM deletion is busy. Try again."}`).
- **All-or-nothing rollback**: If any target VM does not exist or fails validation,
  the transaction rolls back completely; no VMs are deleted and no deletion receipt is saved.

| Status | Result |
|---|---|
| `204 No Content` | All requested entries were deleted, or the request was an idempotent replay of a previously completed deletion with matching `request_id`, actor, and `ids`. |
| `409 Conflict` | At least one requested UUID does not exist. All entries are preserved. |
| `422 Unprocessable Entity` | The payload is invalid or `request_id` conflicts with a different actor or different VM selection. All entries are preserved. |
| `503 Service Unavailable` | Row lock acquisition timed out (5s lock_timeout) due to concurrent operations. Try again. |

Child resources nest under a VM: `/api/vms/{parent_id}/disks`,
`/api/vms/{parent_id}/networks`, `/api/vms/{parent_id}/applications`,
`/api/vms/{vm_id}/audit` (change history, read-only).

### Audit access and restore boundary

- **Access boundary**: `GET /api/vms/{vm_id}/audit` requires the VM record to exist in
  the database. Querying audit history for a deleted VM returns `404 Not Found`.
- **Retention and restore boundary**: Starting in schema revision `0027`, the foreign
  key constraint `audit_log_vm_id_fkey` (`ON DELETE CASCADE`) is dropped. When a VM
  is deleted, its historical rows in `audit_log` are preserved indefinitely. If the
  VM is subsequently restored (from backup or recreation with the same UUID), its
  entire historical audit log is retained and becomes accessible again.

### IP mappings

VM list and detail responses expose `ip_mappings: [{ public_ip, private_ip }]`.
VM create and update (`POST /api/vms`, `PATCH /api/vms/{id}`) accept the same `ip_mappings` field.
Endpoints must correspond to network entries on the same VM with roles `public` and `private` respectively.
Omission preserves existing mappings on update, while an explicit array replaces them, and `[]` clears them.
When submitting `ip_mappings` in `PATCH /api/vms/{id}`, the request must include `network_precondition` matching the concurrency token returned on the most recent VM GET; requests with missing or stale tokens return 409 Conflict.
A child network entry linked in an IP mapping cannot be deleted or have its address/role changed through `/api/vms/{parent_id}/networks/{id}` (returns 409 Conflict); linked edits and unlinking must be performed atomically via VM-level update (`PATCH /api/vms/{id}`).
Adding or editing child network entries via `/api/vms/{parent_id}/networks` that would introduce a duplicate address of an existing linked endpoint also returns 409 Conflict.

## Storage — `/api/storage`

Storage arrays (vendor: `synology`, `netapp`, …) with nested volumes, LUNs, and
shares:

- `/api/storage/arrays/{parent_id}/volumes`
- `/api/storage/volumes/{parent_id}/luns`
- `/api/storage/volumes/{parent_id}/shares`

## Clusters — `/api/clusters`

Cluster groupings with nested `/api/clusters/{parent_id}/nodes`.

## Imports — `/api/imports`

CSV import workflow: upload → preview (diff against existing inventory,
classified `create`/`update`/`unchanged`/`decommission`/`conflict`/`invalid`) →
commit. See `docs/RUNBOOK.md`/`AGENTS.md` for the CSV format and Proxmox
identity-matching rule. The optional `ip_mappings` column accepts
semicolon-separated `public>private` IP pairs (e.g., `203.0.113.4>10.0.0.5;203.0.113.4>10.0.0.6`).
Mappings are additive and resolve against existing or simultaneously imported addresses on the same VM.

### IP mappings in CSV

The optional `ip_mappings` column specifies public-to-private IP pairings:
- **Format**: `public>private` pairs separated by semicolons (e.g. `203.0.113.4>10.0.0.5;203.0.113.4>10.0.0.6`).
- **Update semantics**: Missing or blank cells preserve existing mappings. Nonblank cells add the specified pairs idempotently. Removing mappings is an explicit VM edit.
- **Validation**: Endpoints must exist on the same VM (either already present or included in the row's `public_ip` / `private_ip` columns) with the respective roles.

## VM export — `GET /api/vms/export`

Takes the list filters plus `ids` (repeatable) or `all=true`, and:

- `columns` — comma-separated, ordered export columns (VM scalar fields, `disks`, `private_ip`, `public_ip`, `backup_ip`, `applications`, `ip_mappings`). Omitted = all. Unknown or duplicate names return 422. A custom export containing only `ip_mappings` requires corresponding address endpoints to already exist on the destination during re-import.
- `format` — `csv` (default), `xlsx`, or `json` (preview: `{total, columns, rows}` with the first 5 VMs).
- `disk_layout` — `joined` (default, one cell per VM) or `rows` (one row per disk, VM fields repeated).

When `ip_mappings` is exported, it emits canonical ordered pairs (`public>private;...`). Include address columns (`public_ip`, `private_ip`) in full exports for round-trip re-import compatibility; a custom export containing only mappings requires endpoints to already exist on the target.

## Reports — `/api/reports`

CSV/XLSX export of inventory fields.

## Dashboard — `/api/dashboard`

Aggregate counts and alert summaries for the landing page.

## Settings — `/api/settings`

Admin-only. App-wide settings (`/api/settings/app`) and LDAP configuration
(`/api/settings/ldap`); LDAP bind credentials are encrypted at rest.

## Backups — `/api/backups`

Admin-only. List, trigger, download, and restore Postgres dumps
(`pg_dump -Fc`, magic bytes `PGDMP`) from `BACKUP_DIR`. See
`docs/RUNBOOK.md#backups`.

## User preferences / notifications

- `/api/user/*` — per-user preferences (e.g. saved inventory columns).
- `/api/notifications` — in-app notification feed.

## Error format

Errors are JSON `{"detail": "..."}` or
`{"detail": [...]}` for structured validation errors. The frontend's
`apiRequest()`/`ApiError` (`frontend/src/api/core.ts`) unwrap this uniformly.
