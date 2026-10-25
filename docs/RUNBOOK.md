# Runbook

Operating InventoryMGR in a deployed environment.

## Startup

- Compose uses `just up`. This generates `.env` if missing and runs `podman compose up -d --build`. Inspect services with `just ps` and `just logs`.
- Quadlet setup is in `docs/PODMAN_QUADLET.md`.
- Check readiness with `curl -f http://127.0.0.1:8000/api/health` and `curl -f http://127.0.0.1:3000/`.
- Production images run both application processes as unprivileged UID 1000.

## Configuration

Runtime configuration comes from environment variables. See `.env.example`.

| Variable | Purpose |
|---|---|
| `APP_ENV` | `development` or `production`. Use `production` only over HTTPS because session cookies require a secure connection. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `JWT_SECRET` | Random signing and encryption secret. `just env` generates it. Rotation invalidates sessions and prevents decryption of existing LDAP bind credentials. |
| `SESSION_COOKIE_NAME` and `CSRF_COOKIE_NAME` | Cookie names. Compose forwards the CSRF name to both services. For native or Quadlet deployment, set the same `CSRF_COOKIE_NAME` in backend and frontend runtime environments. The frontend renders it into page metadata at request time; rebuilding is unnecessary. |
| `APP_CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKUP_DIR` | Backup directory, mounted as `/var/lib/inventorymgr/backups` in the backend container. |
| `INVENTORYMGR_API_URL` | Backend URL used by the frontend at build time. |

## Authentication

Local credentials never fall back to LDAP. LDAP identities cannot claim an existing local account, even through an email alias. Login throttles canonical directory lookup identities, retains at most 4,096 active identity keys, and caps global ingress at 300 attempts per minute.

Email fields accept at most 254 bytes; passwords accept at most 1,024 characters. New and reset passwords require at least eight characters.

Access and refresh tokens are bound to each user's stored credential verifier. A password reset invalidates both token types for that user without signing out other users. Upgrading from tokens without this binding requires a one-time fresh login. Restore still invalidates all prior sessions.

## Backups

Scheduled backups run in the Rust backend and are disabled when `APP_ENV=test`.
The admin-only `/api/backups/*` endpoints support creation, listing, downloading, deletion, and restore.

Archives use the `pg_dump -Fc` custom format.
New filenames are `inventorymgr-YYYYMMDDTHHMMSSZ-<label>-<32 lowercase hex UUID>.dump`.
The unique suffix prevents concurrent manual requests from sharing a destination.
Legacy filenames without the UUID suffix remain readable.
Labels contain lowercase letters or underscores. All file operations validate the complete filename before resolving its path.

Restore requires the database role to have `CREATEDB` and enough disk headroom for a staging database plus a prepared archive. Compose and the supplied PostgreSQL container initialize the application role with this privilege; for an externally managed role, grant it explicitly before using API restore. Restore loads the archive into an isolated `im_restore_<live-DB-OID>_<32 lowercase hex UUID>` database, validates its application revision, applies supported migrations, and prepares a new archive before touching live rows or creating the recovery backup. Unknown revisions return HTTP 400 without invalidating live tokens or changing data.
The destructive restore runs in one transaction with `--exit-on-error`.
A failed command returns an error and cannot produce a successful backup job.
The recovery archive retains the state immediately before restore.

Uploads stream outside the database gate. The administrator and CSRF token are checked before upload and revalidated immediately before exclusive cutover. Ordinary bodies are capped at 2 MiB, CSV multipart uploads at 6 MiB, and restore archives at 2 GiB.

Only one backend instance may own a database at a time. A dedicated advisory connection rejects overlapping processes and remains held through graceful drain. Its connection is probed every five seconds with a two-second timeout; failure stops the server without reconnecting. Detection can take approximately seven seconds plus scheduling delay. This is not instantaneous distributed fencing or an HA deployment contract.

Dumps remain hidden as `.dump.partial` until completed. On startup, interrupted jobs become failed and their partial files are removed. Final archives are not deleted merely because a restored historical job says `running`.

After obtaining ownership, startup reclaims abandoned staging databases only when their exact generated name matches the current live database's OID and their owner is the current PostgreSQL role. Other scopes, owners, malformed names, and old unscoped names are left untouched.

SIGINT and SIGTERM initiate graceful shutdown; allow at least 30 seconds before forced termination.

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
PostgreSQL 16-to-17 upgrades use `tools/migrate-postgres-16-to-17.sh --confirm` during an explicit maintenance window. The script stops and masks application writers before copying the stopped PostgreSQL 16 volume, validates the PostgreSQL 17 candidate in isolation, and compares database and table row counts before promotion. It retains both the immutable PostgreSQL 16 snapshot and the PostgreSQL 17 volume. Before promotion, rollback restores the PostgreSQL 16 Quadlet configuration; after promotion, rollback requires stopping writers and deliberately selecting the retained PostgreSQL 16 snapshot. Review the script's private evidence directory before deleting either volume.

## CSV import

The CSV importer is the sole bulk VM importer.
The disks column uses `name:size[:storage_name[:storage_type]]`.
Proxmox updates require both `external_id` or `vmid` and `name` to match an existing VM.

Import is preview-then-commit.
`/api/imports` reports `create`, `update`, `unchanged`, `decommission`, `conflict`, or `invalid` for each row before writing data.


CSV exports prefix spreadsheet formula trigger characters with an apostrophe. XLSX exports use explicit string cells rather than formula cells.

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
`just setup` prepares it with `uv sync --frozen --extra dev`.

`just verify` builds Rust, runs backend and frontend checks, compares HTTP contracts, checks empty and historical database upgrades, exercises restore concurrency, and runs Playwright.
Evidence defaults to a fresh `.audit/verification-<UTC timestamp>` directory. Set `VERIFY_OUTPUT_DIR` to choose another new directory; existing output paths are rejected. `SUCCESS` is written only after every gate passes.
The three migration startup scenarios include a separate historical-row preservation assertion.
HTTP operation coverage includes unauthenticated boundary probes and does not by itself prove every successful workflow.

`just e2e` uses `tools/run-rust-e2e.sh`.
It creates disposable PostgreSQL and application processes on allocated ports and removes only its own resources.
It never falls back to the application's `DATABASE_URL`.
`just build-prod` defaults the frontend backend URL to `http://inventorymgr-backend:8000` for Quadlet networking.

## Dependency policy

Use the previous stable minor line's latest patch where it remains safe and compatible. Keep an already-newer safe line rather than downgrading solely to satisfy that rule. Security fixes and runtime/API compatibility take precedence.

Runtime pins are Rust 1.98.1 (`backend-rust/rust-toolchain.toml`), Node.js 24.22.1 (`.node-version`), pnpm 12.14.0 (`frontend/package.json`), and Python 3.14.7 (`backend/.python-version`). Required uv tool version is `>=0.12.18` (`backend/pyproject.toml`). Lockfiles and frozen/locked installation are required.
Container base images and PostgreSQL deployment/test images are pinned by manifest digest. Retain the PostgreSQL deployment distribution when refreshing a digest; switching Alpine and glibc distributions can change collation behavior.

Next.js 16.4.3 is a security exception: the preceding minor is affected by critical advisories fixed in 16.4.1. Rust retains jsonwebtoken 9.3.1 to avoid a separate crypto-provider migration and rand_core 0.6.4 to match argon2 0.5's password-hash trait family. These compatibility exceptions passed the dependency advisory scan; this does not establish upstream long-term support.

Application image bases use Debian 13 (Trixie), a security exception to the older distribution baseline after the Debian 12 image scan reported numerous vendor-unfixed findings. Runtime package updates are applied during image builds. The frontend runtime excludes npm, Corepack, and Yarn; its healthcheck uses Node's built-in HTTP client rather than adding curl. The PostgreSQL deployment remains on its pinned Alpine image; this changes application/client images, not the database volume's distribution.

Reaudit after any non-frozen dependency resolution. Do not downgrade a patched package merely to reach N−1.
