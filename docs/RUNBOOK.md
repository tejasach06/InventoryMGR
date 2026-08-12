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
| `db` | `${POSTGRES_PORT:-5432}` | PostgreSQL 16 |
| `backend` | `${BACKEND_PORT:-8000}` | FastAPI |
| `frontend` | `${FRONTEND_PORT:-3000}` | Next.js |
## Health Checks

| Check | Command | Expected |
|-------|---------|---------|
| Backend alive | `curl http://localhost:8000/api/health` | `{"status":"ok"}` |
| Frontend alive | `curl http://localhost:3000/` | HTTP 200 |
| PostgreSQL | `pg_isready -h 127.0.0.1 -p 54329 -U inventorymgr` | `accepting connections` |

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
