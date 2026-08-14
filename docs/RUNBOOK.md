# InventoryMGR Runbook

<!-- AUTO-GENERATED: deployment steps, health checks, and env table generated from justfile, docker-compose.yml, frontend/package.json, backend/app/core/config.py -->

## Environment Variables

<!-- AUTO-GENERATED from backend/app/core/config.py -->

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_ENV` | No | `development` | Runtime mode: `development`, `test`, `production` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (`postgresql+psycopg://...`) |
| `TEST_DATABASE_URL` | No | — | Separate DB for pytest; set to the `_test` variant |
| `JWT_SECRET` | **Yes in prod** | placeholder | Signing key for session tokens (`just env` generates 32+ random bytes) |
| `SESSION_COOKIE_NAME` | No | `inventorymgr_session` | Session cookie name |
| `CSRF_COOKIE_NAME` | No | `inventorymgr_csrf` | CSRF cookie name |
| `APP_CORS_ORIGINS` | No | `http://localhost:3000,...` | Comma-separated allowed origins |
| `INVENTORYMGR_API_URL` | Yes (frontend build) | — | Backend URL baked into Next.js build (`http://127.0.0.1:8000` for PM2, `http://backend:8000` for Podman) |
| `POSTGRES_PORT` | No | `5432` | Host port mapping for compose |
| `BACKEND_PORT` | No | `8000` | Host port mapping for compose |
| `FRONTEND_PORT` | No | `3000` | Host port mapping for compose |
## Deployment: PM2

Single command bootstrap (provisions database, installs dependencies, migrates schema, builds frontend, and starts PM2 processes):

```bash
just up-local
```

`ecosystem.config.js` is committed at the repo root and may be customized per host.

### PM2 management

```bash
just pm2-status     # process table
just pm2-logs       # tail logs
just pm2-restart    # rolling restart
just pm2-stop       # stop without killing daemon
just pm2-kill       # kill daemon entirely
just pm2-save       # persist across reboots
just pm2-startup    # install OS init script
```

### Reverse proxy (nginx)

```nginx
location /api/ { proxy_pass http://127.0.0.1:8000; }
location /     { proxy_pass http://127.0.0.1:3000; }
```

### First login

Navigate to `/login`. If no users exist the page shows **Create admin account** (or check `GET /api/auth/setup`).

## Deployment: Podman

```bash
# Start all services
just up

# Tail logs
just logs

# Check status
just ps

# Stop
just down
```

To move a conflicting port mapping:

```bash
FRONTEND_PORT=3100 just up
```

| Service | Port | Description |
|---------|------|-------------|
| `db` | `${POSTGRES_PORT:-5432}` | PostgreSQL 17 |
| `backend` | `${BACKEND_PORT:-8000}` | FastAPI |
| `frontend` | `${FRONTEND_PORT:-3000}` | Next.js |

## Deployment: Podman Quadlet (systemd, rootless)

Use Quadlet on production hosts when systemd should own rootless Podman
containers directly. This is separate from the compose-based `just up` path.

### Build production images

```bash
# Frontend rewrites /api/* to the backend container on the Quadlet network.
just build-prod

# Optional: bake a different backend URL into Next.js rewrites.
INVENTORYMGR_API_URL=http://inventorymgr-backend:8000 just build-prod
```

### Create production secrets

```bash
just quadlet-secrets
```

The target is idempotent and creates these Podman secrets if absent:

- `inventorymgr-jwt-secret` → `JWT_SECRET`
- `inventorymgr-postgres-password` → PostgreSQL `POSTGRES_PASSWORD`
- `inventorymgr-database-url` → backend `DATABASE_URL`

Keep the PostgreSQL password and database URL secrets in sync. If only one of
the database secrets exists, delete both and rerun `just quadlet-secrets`.

### Install Quadlet units

```bash
mkdir -p ~/.config/containers/systemd
cp quadlet/* ~/.config/containers/systemd/
systemctl --user daemon-reload
```

The committed units create a shared `inventorymgr` network, an
`inventorymgr-pgdata` volume, and these services:

| Service | Host binding | Description |
|---------|--------------|-------------|
| `inventorymgr-db.service` | none | PostgreSQL 17 |
| `inventorymgr-backend.service` | `127.0.0.1:8000` | FastAPI API |
| `inventorymgr-frontend.service` | `127.0.0.1:3000` | Next.js frontend |

### Activate at boot

```bash
loginctl enable-linger "$USER"
systemctl --user enable --now inventorymgr-db.service
systemctl --user enable --now inventorymgr-backend.service
systemctl --user enable --now inventorymgr-frontend.service
```

Quadlet supports `After=`/`Requires=` ordering, not compose-style
`condition: service_healthy`. The backend image runs Alembic migrations on
startup and the app uses its existing startup behavior if PostgreSQL is still
initializing.

### Status and logs

```bash
systemctl --user status inventorymgr-db.service inventorymgr-backend.service inventorymgr-frontend.service
journalctl --user -u inventorymgr-backend.service -f
journalctl --user -u inventorymgr-frontend.service -f
```

Health checks:

```bash
curl http://127.0.0.1:8000/api/health
curl -I http://127.0.0.1:3000/
```

### Rollback Quadlet deployment

Build or retag the previous images, then restart the services:

```bash
systemctl --user stop inventorymgr-frontend.service inventorymgr-backend.service
podman tag localhost/inventorymgr-backend:<previous> localhost/inventorymgr-backend:latest
podman tag localhost/inventorymgr-frontend:<previous> localhost/inventorymgr-frontend:latest
systemctl --user start inventorymgr-backend.service inventorymgr-frontend.service
```

Stop the whole stack if needed:

```bash
systemctl --user stop inventorymgr-frontend.service inventorymgr-backend.service inventorymgr-db.service
```

## Health Checks

| Check | Command | Expected |
|-------|---------|---------|
| Backend alive | `curl http://localhost:8000/api/health` | `{"status":"ok"}` |
| Frontend alive | `curl http://localhost:3000/` | HTTP 200 |
| PostgreSQL | `pg_isready -h 127.0.0.1 -p 54329 -U inventorymgr` | `accepting connections` |

### PostgreSQL major-version upgrade (16 → 17)

PostgreSQL data files are not compatible across major versions. If
`inventorymgr-db` is still running Postgres 16 on a host where the Quadlet
units / `docker-compose.yml` now pin `postgres:17-alpine`, do **not** just
restart the service — that leaves the container unable to read the old data
directory. Use the migration script instead:

```bash
tools/migrate-postgres-16-to-17.sh
```

It dumps the running 16 instance (`pg_dumpall`), stands up a scratch PG17
volume, restores into it, sanity-checks a row count, then cuts the
`inventorymgr-pgdata` volume over — preserving the original PG16 data as
`inventorymgr-pgdata-pg16-backup` (not deleted; remove manually once you've
confirmed the app is healthy on PG17). Run it on the production host as the
user owning the Quadlet units. See the script header for full details and
prerequisites.

The PM2 deployment path uses whatever PostgreSQL the host package manager
installed — it is not managed by this repo's container images, so a 16→17
upgrade there follows your OS's normal `pg_upgrade`/`pg_dumpall` procedure,
not this script.

## Alerts

Alert triggers, thresholds, and tag-based suppression are documented in
[ALERTS.md](ALERTS.md).

## Common Issues

### Backend won't start — `JWT_SECRET must be changed in production`

Generate a fresh secret and write `.env`:
```bash
just env
```
### Alembic migration fails — `relation already exists`

The DB is ahead of the migration history. Check with:
```bash
cd backend && uv run alembic current
uv run alembic history --verbose
```

### Frontend build fails — `INVENTORYMGR_API_URL not set`

Pass it at build time:
```bash
INVENTORYMGR_API_URL=http://127.0.0.1:8000 bun run build
```

### PostgreSQL not accepting connections

```bash
podman compose -f docker-compose.e2e-db.yml up -d
podman compose -f docker-compose.e2e-db.yml logs db-test
pg_isready -h 127.0.0.1 -p 54329 -U inventorymgr
```

## Rollback

### PM2

Rebuild the previous frontend, then:
```bash
just pm2-restart
```

### Database

Alembic supports step-by-step downgrade:
```bash
cd backend && uv run alembic downgrade -1
```

Check available revisions:
```bash
cd backend && uv run alembic history
```

<!-- END AUTO-GENERATED -->
