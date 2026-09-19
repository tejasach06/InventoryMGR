# Runbook

Operating InventoryMGR in a deployed environment.

## Startup

- **Compose**: `just up` (generates `.env` if missing, `podman compose up -d
  --build`). Verify with `just ps` / `just logs`.
- **Quadlet**: see `docs/PODMAN_QUADLET.md`.
- Readiness: `curl -f http://127.0.0.1:8000/api/health` and
  `curl -f http://127.0.0.1:3000/`.

## Configuration

All runtime config is env vars, sourced from `.env` (see `.env.example`):

| Var | Purpose |
|---|---|
| `APP_ENV` | `development` or `production`. Set `production` **only** when served over HTTPS — enables `Secure` cookies. |
| `DATABASE_URL` | `postgresql+psycopg://...` connection string. |
| `JWT_SECRET` | 32-byte random secret (`just env` generates one). Rotating invalidates all sessions. |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | Cookie names, change only if colliding with another app on the same domain. |
| `APP_CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKUP_DIR` | Host path (bind-mounted into the backend container as `/var/lib/inventorymgr/backups`). |
| `INVENTORYMGR_API_URL` | Frontend's backend base URL (build-time for Next.js). |

## Backups

- Scheduled automatically by `backup_scheduler.py` (runs inside the backend
  process lifespan, skipped when `APP_ENV=test`).
- Manual trigger, list, download, restore: `/api/backups/*` (admin-only), or
  directly via `pg_dump`/`pg_restore` against `DATABASE_URL` if the API is
  unavailable.
- Files: `pg_dump -Fc` custom-format dumps, named
  `inventorymgr-YYYYMMDDTHHMMSSZ-<label>.dump` in `BACKUP_DIR`, validated by a
  strict filename regex before any file-path operation (path traversal guard).
- **Restore**: use the `/api/backups/{filename}/restore` endpoint, or manually:
  `pg_restore -d <DATABASE_URL as libpq> --clean --if-exists <file>.dump`.
  Take a fresh backup before restoring over live data.

## Database migrations

Migrations are generated, never hand-written:

```
cd backend && uv run alembic revision --autogenerate -m "..."
```

Review the generated diff and its `downgrade()` before committing. Apply with
`uv run alembic upgrade head` (run automatically on backend container start —
see `backend/Dockerfile`/entrypoint).

Postgres major-version upgrades: see `tools/migrate-postgres-16-to-17.sh`.

## CSV import

- The CSV importer (`backend/app/services/csv_import.py`) is the **sole** way
  to bulk-load VMs (Proxmox/VMware exports or hand-built sheets).
- Disks column format: `name:size[:storage_name[:storage_type]]`.
- Proxmox identity matching for update-vs-create requires **both**
  `external_id`/`vmid` **and** `name` to match an existing row; a mismatch on
  either is treated as a new/conflicting record.
- Import is preview-then-commit: `/api/imports` returns a diff
  (`create`/`update`/`unchanged`/`decommission`/`conflict`/`invalid` per row)
  before anything is written.

## Alerts

See `docs/ALERTS.md`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend container unhealthy | `podman compose logs backend`; confirm `DATABASE_URL` reachable and `db` healthcheck passed first (`depends_on: service_healthy`). |
| Frontend 502/unreachable | Confirm backend healthy first (frontend `depends_on` backend); check `INVENTORYMGR_API_URL` matches the backend's reachable address from the frontend container's network. |
| Login fails for an LDAP user | Check `/api/settings/ldap` config (admin-only) and that bind credentials decrypt correctly (`ldap3`/`cryptography`); test with a local/admin account first to isolate LDAP vs. general auth. |
| 403 on `/api/settings/*` | Expected for non-admin roles — verify the user's role, not the endpoint. |
| Migration drift | Never hand-edit `backend/alembic/versions/`; regenerate with `--autogenerate` and diff against the model change that caused drift. |
| Backup restore fails filename check | Filename must match `inventorymgr-\d{8}T\d{6}Z-[a-z_]+\.dump`; don't rename dump files manually. |

## Deployment

`./deploy.sh` deploys the `main` branch via Podman rootless Compose:
service-local build contexts (`./backend`, `./frontend`), `.dockerignore`
excludes `.venv`/`node_modules`, healthchecks target `127.0.0.1`. Run
`just verify` before deploying.
