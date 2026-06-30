# InventoryMGR Runbook

<!-- AUTO-GENERATED: deployment steps, health checks, and env table generated from ecosystem.config.js, docker-compose.yml, backend/app/core/config.py -->

## Environment Variables

<!-- AUTO-GENERATED from backend/app/core/config.py -->

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_ENV` | No | `development` | Runtime mode: `development`, `test`, `production` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (`postgresql+psycopg://...`) |
| `TEST_DATABASE_URL` | No | — | Separate DB for pytest; set to the `_test` variant |
| `JWT_SECRET` | **Yes in prod** | placeholder | Signing key for session tokens — must be 32+ random bytes in production |
| `SESSION_COOKIE_NAME` | No | `inventorymgr_session` | Session cookie name |
| `CSRF_COOKIE_NAME` | No | `inventorymgr_csrf` | CSRF cookie name |
| `APP_CORS_ORIGINS` | No | `http://localhost:3000,...` | Comma-separated allowed origins |
| `UPLOAD_DIR` | No | `/data/uploads` | Directory for file attachments |
| `INVENTORYMGR_API_URL` | Yes (frontend build) | — | Backend URL baked into the Next.js build (`http://127.0.0.1:8000` for PM2, `http://backend:8000` for Docker) |

## Deployment: PM2

### 1. Provision PostgreSQL

```bash
devbox run db:init
devbox run db:start
devbox run db:create
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set APP_ENV=production, DATABASE_URL, JWT_SECRET, APP_CORS_ORIGINS, UPLOAD_DIR
```

### 3. Install dependencies and migrate

```bash
cd backend && uv sync
cd backend && uv run alembic upgrade head
```

### 4. Build frontend

```bash
cd frontend && bun install
INVENTORYMGR_API_URL=http://127.0.0.1:8000 bun run build
```

### 5. Update `ecosystem.config.js`

Set the correct absolute paths for `script`, `cwd`, and env values in `ecosystem.config.js`.

### 6. Start with PM2

```bash
just pm2-start
just pm2-save       # persist across reboots
just pm2-startup    # install OS init script
```

### 7. PM2 management

```bash
just pm2-status     # process table
just pm2-logs       # tail logs
just pm2-restart    # rolling restart
just pm2-stop       # stop without killing daemon
just pm2-kill       # kill daemon entirely
```

### 8. Reverse proxy (nginx)

```nginx
location /api/ { proxy_pass http://127.0.0.1:8000; }
location /     { proxy_pass http://127.0.0.1:3000; }
```

### 9. First login

Navigate to `/login`. If no users exist the page shows **Create admin account**.

## Deployment: Docker

```bash
# Start all services
docker compose up -d

# Tail logs
docker compose logs -f

# Stop
docker compose down
```

| Service | Port | Description |
|---------|------|-------------|
| `db` | 5432 | PostgreSQL 16 |
| `backend` | 8000 | FastAPI |
| `frontend` | 3000 | Next.js |

## Health Checks

| Check | Command | Expected |
|-------|---------|---------|
| Backend alive | `curl http://localhost:8000/api/health` | `{"status":"ok"}` |
| Frontend alive | `curl http://localhost:3000/` | HTTP 200 |
| PostgreSQL | `pg_isready -h 127.0.0.1 -p 54329 -U inventorymgr` | `accepting connections` |

## Common Issues

### Backend won't start — `JWT_SECRET must be changed in production`

Set a real secret in `.env`:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
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
devbox run db:start          # start if stopped
pg_ctl -D .devbox/postgres/data status   # check status
cat .devbox/postgres/postgres.log        # check logs
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
