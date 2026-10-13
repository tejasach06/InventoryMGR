# Runbook

Operating InventoryMGR in a deployed environment.

## Startup

- **Compose**: `just up` (generates `.env` if missing, `podman compose up -d --build`). Verify with `just ps` / `just logs`.
- **Quadlet**: see `docs/PODMAN_QUADLET.md`.
- Readiness: `curl -f http://127.0.0.1:8000/api/health` and `curl -f http://127.0.0.1:3000/`.

## Configuration

All runtime config is env vars, sourced from `.env` (see `.env.example`):

| Var | Purpose |
|---|---|
| `APP_ENV` | `development` or `production`. Set `production` **only** when served over HTTPS — enables `Secure` cookies. |
| `DATABASE_URL` | `postgresql://...` connection string. |
| `JWT_SECRET` | 32-byte random secret (`just env` generates one). Rotating invalidates all sessions. |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | Cookie names, change only if colliding with another app on the same domain. |
| `APP_CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKUP_DIR` | Host path (bind-mounted into the backend container as `/var/lib/inventorymgr/backups`). |
| `INVENTORYMGR_API_URL` | Frontend's backend base URL (build-time for Next.js). |

## Backups

- Scheduled automatically by `backend-rust/src/api/auxiliary/backups.rs`, skipped when `APP_ENV=test`.
- Manual trigger, list, download, restore: `/api/backups/*` (admin-only), or directly via `pg_dump`/`pg_restore` against `DATABASE_URL` if the API is unavailable.
- Files: `pg_dump -Fc` custom-format dumps, named `inventorymgr-YYYYMMDDTHHMMSSZ-<label>.dump` in `BACKUP_DIR`, validated by a strict filename regex before any file-path operation (path traversal guard).
- **Restore**: use the `/api/backups/{filename}/restore` endpoint, or manually: `pg_restore -d <DATABASE_URL as libpq> --clean --if-exists <file>.dump`. Take a fresh backup before restoring over live data.

## Database migrations

The native migrator in `backend-rust/src/db/mod.rs` executes the embedded revision chain in `backend-rust/migrations/0001_inventory_schema.sql` through SQLx 0.9.
Startup locks migration execution with a PostgreSQL advisory lock. Empty databases receive the full chain. Recognized historical Alembic revisions receive the remaining upgrades through head `0024`.
The preserved `alembic_version.version_num` records the applied revision. There is no `_sqlx_migrations` ledger or `sqlx::migrate!` macro. Unknown revisions and nonempty unversioned schemas fail startup rather than guessing an upgrade.
Postgres major-version upgrades: see `tools/migrate-postgres-16-to-17.sh`.

## CSV import

- The CSV importer (`backend-rust/src/api/auxiliary/imports.rs`) is the sole way to bulk-load VMs from exports or hand-built sheets.
- Disks column format: `name:size[:storage_name[:storage_type]]`.
- Proxmox identity matching for update-vs-create requires **both** `external_id`/`vmid` **and** `name` to match an existing row; a mismatch on either is treated as a new/conflicting record.
- Import is preview-then-commit: `/api/imports` returns a diff (`create`/`update`/`unchanged`/`decommission`/`conflict`/`invalid` per row) before anything is written.

## Alerts

See `docs/ALERTS.md`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend container unhealthy | `podman compose logs backend`; confirm `DATABASE_URL` reachable and `db` healthcheck passing. |
| Frontend 502/unreachable | Confirm backend healthy first (frontend `depends_on` backend); check `INVENTORYMGR_API_URL` network resolution. |
| Login fails for an LDAP user | Check `/api/settings/ldap` config (admin-only) and that bind credentials decrypt correctly with `JWT_SECRET`. |
| 403 on `/api/settings/*` | Expected for non-admin roles — verify the user's role, not the endpoint. |
| Migration drift | Inspect `backend-rust/migrations/0001_inventory_schema.sql` and `SELECT version_num FROM alembic_version`; expected head is `0024`. Back up before repair and test recovery on an isolated copy. |
| Backup restore fails filename check | Filename must match `inventorymgr-\\d{8}T\\d{6}Z-[a-z_]+\\.dump`; don't rename dump files manually. |

## Deployment

`./deploy.sh` deploys the `main` branch via Podman rootless Compose:
service-local build contexts (`./backend-rust`, `./frontend`), `.dockerignore`
excludes `target`/`node_modules`, healthchecks target `127.0.0.1`. Run
`just verify` before deploying.

## Rust Backend Migration (2026-10-10)

The operational backend runs native Rust with Axum 0.8, SQLx 0.9, and Postgres.
- **Runtime**: Entire operational backend is Rust-only; no Python runtime exists in production containers or host deploy paths.
- **Image Artifact**: Built and verified using isolated image `localhost/inventorymgr-backend:isolated-smoke` based on multi-stage `backend-rust/Dockerfile` (`rust:1.98-bookworm` build stage, `docker.io/library/postgres:17` runtime stage with native `pg_dump`/`pg_restore`).
- **Health and HTTP Verification**: Proved against an isolated database with healthy HTTP 200 responses on `/api/health` and verified HTTP routing and authentication on `/api/auth/login`.
- **Parity Oracle**: The Python source tree under `backend/` is retained strictly as an explicit parity reference oracle for historical contract checks and schema verification tools (`tools/rust-parity/`).
- **Development Tooling**: `devbox.json` updated with native Rust toolchain (`rustc`, `cargo`, `cargo-audit`, `nodejs@26.8.0`, `just`, `postgresql@17`), and `justfile` recipes corrected to compile Rust binaries, eliminate legacy `ecosystem.config.js` and `pm2` invocations, and enforce explicit `cargo audit` checks without unconditional error suppression.

`just setup` explicitly syncs the test-only Python oracle with `uv sync --extra dev`. Python is not part of the production image.
`just verify` rebuilds this checkout, runs Cargo tests and frontend checks, HTTP parity, four migration cases, restore concurrency, and Playwright. Evidence defaults to `.audit/verification`; `VERIFY_OUTPUT_DIR` overrides it.
`just e2e` and the frontend `e2e` command use `tools/run-rust-e2e.sh`. The runner owns a disposable Postgres container and process groups, allocates ports, rebuilds both applications, and removes its resources on exit. It never uses `DATABASE_URL` as a test fallback.
`just build-prod` defaults the frontend rewrite to `http://inventorymgr-backend:8000` for Quadlet networking. Override `INVENTORYMGR_API_URL` only for the intended deployment network.

