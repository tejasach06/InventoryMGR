# Runbook

Operating InventoryMGR in a deployed environment.

## Startup

- Compose uses `just up`. This generates `.env` if missing and runs `podman compose up -d --build`. Inspect services with `just ps` and `just logs`.
- Quadlet setup is in `docs/PODMAN_QUADLET.md`.
- Check readiness with `curl -f http://127.0.0.1:8000/api/health` and `curl -f http://127.0.0.1:3000/`.

## Configuration

Runtime configuration comes from environment variables. See `.env.example`.

| Variable | Purpose |
|---|---|
| `APP_ENV` | `development` or `production`. Use `production` only over HTTPS because session cookies require a secure connection. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `JWT_SECRET` | Random signing and encryption secret. `just env` generates it. Rotation invalidates sessions and prevents decryption of existing LDAP bind credentials. |
| `SESSION_COOKIE_NAME` and `CSRF_COOKIE_NAME` | Cookie names. Change them if another application uses the same names on this domain. |
| `APP_CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKUP_DIR` | Backup directory, mounted as `/var/lib/inventorymgr/backups` in the backend container. |
| `INVENTORYMGR_API_URL` | Backend URL used by the frontend at build time. |

## Backups

Scheduled backups run in the Rust backend and are disabled when `APP_ENV=test`.
The admin-only `/api/backups/*` endpoints support creation, listing, downloading, deletion, and restore.

Archives use the `pg_dump -Fc` custom format.
New filenames are `inventorymgr-YYYYMMDDTHHMMSSZ-<label>-<32 lowercase hex UUID>.dump`.
The unique suffix prevents concurrent manual requests from sharing a destination.
Legacy filenames without the UUID suffix remain readable.
Labels contain lowercase letters or underscores. All file operations validate the complete filename before resolving its path.

Restore validates the entire archive with `pg_restore` before changing the database or creating the recovery backup.
The destructive restore runs in one transaction with `--exit-on-error`.
A failed command returns an error and cannot produce a successful backup job.
The recovery archive retains the state immediately before restore.

Session and refresh tokens carry a persisted session-generation identifier.
Restore rotates this identifier before and after the database operation, so earlier tokens cannot remain valid within the same second.
Session invalidation does not depend on recording the job or retaining the requesting administrator in the restored database.
If invalidation cannot be persisted, `BACKUP_DIR/.restore-auth-blocked` keeps authentication blocked across process restarts. Repair the schema, rotate the persisted session generation and epoch cutoff, remove this marker, and restart only after confirming that the repair succeeded. Removing the marker alone does not repair invalidation.

Take a fresh backup before manually restoring live data.
For recovery outside the API, use `pg_restore --single-transaction --exit-on-error --clean --if-exists -d <database> <archive>` and invalidate sessions before reopening access.

## Database migrations

The native migrator in `backend-rust/src/db/mod.rs` executes the embedded revision chain in `backend-rust/migrations/0001_inventory_schema.sql` through SQLx.
Startup uses a PostgreSQL advisory lock. Empty databases receive the full chain.
Recognized historical Alembic revisions receive the remaining upgrades through head `0024`.

`alembic_version.version_num` remains the revision ledger.
There is no `_sqlx_migrations` ledger.
Unknown revisions and nonempty unversioned schemas fail startup.
For PostgreSQL major-version upgrades, see `tools/migrate-postgres-16-to-17.sh`.

## CSV import

The CSV importer is the sole bulk VM importer.
The disks column uses `name:size[:storage_name[:storage_type]]`.
Proxmox updates require both `external_id` or `vmid` and `name` to match an existing VM.

Import is preview-then-commit.
`/api/imports` reports `create`, `update`, `unchanged`, `decommission`, `conflict`, or `invalid` for each row before writing data.

## Alerts

See `docs/ALERTS.md`.
Both `template` and `backup` tags exclude VMs from alert predicates, regardless of case.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend container unhealthy | Read `podman compose logs backend` and confirm database readiness. |
| Frontend returns 502 | Confirm backend health and the `INVENTORYMGR_API_URL` network address. |
| LDAP login fails | Inspect the admin-only LDAP settings and confirm that the bind credential decrypts with the configured `JWT_SECRET`. |
| Settings endpoint returns 403 | These endpoints require an administrator. |
| Migration drift | Compare `alembic_version` with head `0024`. Test repair on an isolated copy before touching live data. |
| Backup filename rejected | Keep the generated archive name. Only the documented timestamp, label, optional UUID suffix, and `.dump` extension are allowed. |
| Access blocked after restore failure | Check restore and invalidation errors before restarting. Confirm database integrity and session-generation persistence before reopening access. |

## Deployment

`./deploy.sh` deploys `main` through rootless Podman Compose.
Backend and frontend build from service-local contexts.
Healthchecks target `127.0.0.1`.
Run `just verify` and `just audit` before deploying.

The production backend is Rust-only.
Python under `backend/` is retained as a test-only parity oracle, not a deployment runtime.
`just setup` prepares it with `uv sync --extra dev`.

`just verify` builds Rust, runs backend and frontend checks, compares HTTP contracts, checks empty and historical database upgrades, exercises restore concurrency, and runs Playwright.
Evidence defaults to `.audit/verification`. Set `VERIFY_OUTPUT_DIR` to choose another directory.
The three migration startup scenarios include a separate historical-row preservation assertion.
HTTP operation coverage includes unauthenticated boundary probes and does not by itself prove every successful workflow.

`just e2e` uses `tools/run-rust-e2e.sh`.
It creates disposable PostgreSQL and application processes on allocated ports and removes only its own resources.
It never falls back to the application's `DATABASE_URL`.
`just build-prod` defaults the frontend backend URL to `http://inventorymgr-backend:8000` for Quadlet networking.
