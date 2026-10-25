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
