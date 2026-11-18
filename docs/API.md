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

Child resources nest under a VM: `/api/vms/{parent_id}/disks`,
`/api/vms/{parent_id}/networks`, `/api/vms/{parent_id}/applications`,
`/api/vms/{vm_id}/audit` (change history, read-only).

### IP mappings

VM list and detail responses expose `ip_mappings: [{ public_ip, private_ip }]`.
VM create and update (`POST /api/vms`, `PATCH /api/vms/{id}`) accept the same `ip_mappings` field.
Endpoints must correspond to network entries on the same VM with roles `public` and `private` respectively.
Omission preserves existing mappings on update, while an explicit array replaces them, and `[]` clears them.
A child network entry linked in an IP mapping cannot be deleted or have its address/role changed through `/api/vms/{parent_id}/networks/{id}` (returns 409 Conflict); linked edits and unlinking must be performed atomically via VM-level update (`PATCH /api/vms/{id}`).

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
identity-matching rule.

### IP mappings in CSV

The optional `ip_mappings` column specifies public-to-private IP pairings:
- **Format**: `public>private` pairs separated by semicolons (e.g. `203.0.113.4>10.0.0.5;203.0.113.4>10.0.0.6`).
- **Update semantics**: Missing or blank cells preserve existing mappings. Nonblank cells add the specified pairs idempotently. Removing mappings is an explicit VM edit.
- **Validation**: Endpoints must exist on the same VM (either already present or included in the row's `public_ip` / `private_ip` columns) with the respective roles.

## VM export — `GET /api/vms/export`

Takes the list filters plus `ids` (repeatable) or `all=true`, and:

- `columns` — comma-separated, ordered export columns (VM scalar fields, `disks`, `private_ip`, `public_ip`, `backup_ip`, `applications`, `ip_mappings`). Omitted = all. Unknown or duplicate names return 422.
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
