# InventoryMGR

InventoryMGR is a small full-stack inventory manager for virtual machines. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based login, role-based access control, VM inventory CRUD, user administration, and CSV preview/commit imports.

## Stack

- Backend: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- Frontend: Next.js, React, TypeScript, Tailwind CSS, TanStack Query
- Tooling: devbox, uv, bun, just, pytest, Vitest, Playwright

## Main features

- First-deployment admin account creation from the login page.
- Session-cookie authentication with CSRF protection for state-changing requests.
- Roles: `admin`, `editor`, and `viewer`.
- VM inventory list/detail/create/edit/delete.
- CSV import preview and commit flow.
- Admin-only user management.

## Project layout

```text
backend/   FastAPI app, database models, Alembic migrations, pytest tests
frontend/  React app, API client, UI routes, unit and E2E tests
justfile   Common local commands
devbox.json Development runtime and PostgreSQL scripts
```

## Configuration

Copy the example environment file and edit secrets before running outside local development:

```bash
cp .env.example .env
```

Important variables:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development`, `test`, or `production` |
| `DATABASE_URL` | PostgreSQL URL used by the backend |
| `TEST_DATABASE_URL` | PostgreSQL URL used by backend tests |
| `JWT_SECRET` | Secret used to sign session tokens |
| `APP_CORS_ORIGINS` | Comma-separated frontend origins allowed by the API |

For production, set a strong `JWT_SECRET`. The first admin account is created from the `/login` setup page when the users table is empty.

## Run locally

The easiest local path is devbox:

```bash
devbox run setup
just api-dev
just web-dev
```

Open the app at:

```text
http://127.0.0.1:3000
```

On a fresh database, `/login` shows `Create admin account`. Create the first admin there; later visits show the normal sign-in form.

If setup has already run, start only the database and apps:

```bash
just db-up
just api-dev
just web-dev
```

## Tests

```bash
just api-test
just web-test
just e2e
```

Full verification:

```bash
just verify
```

## Deployment with PM2

This repository uses PM2 for process management in production.

### 1. Provision PostgreSQL

Create a production database and user, then set `DATABASE_URL`, for example:

```text
postgresql+psycopg://inventorymgr:<password>@<host>:5432/inventorymgr
```

### 2. Configure production environment

Create `.env` on the server:

```bash
APP_ENV=production
DATABASE_URL=postgresql+psycopg://inventorymgr:<password>@<host>:5432/inventorymgr
JWT_SECRET=<long-random-secret>
SESSION_COOKIE_NAME=inventorymgr_session
CSRF_COOKIE_NAME=inventorymgr_csrf
APP_CORS_ORIGINS=https://your-domain.example
INVENTORYMGR_API_URL=http://127.0.0.1:8000
NODE_ENV=production
```

### 3. Install backend dependencies and migrate

```bash
cd backend
uv sync
uv run alembic upgrade head
```

### 4. Build frontend

```bash
cd frontend
bun install
bun run build
```

### 5. Start with PM2

```bash
# From repo root
pm2 start ecosystem.config.js
pm2 save          # Persist process list across reboots
pm2 startup       # Generate init script (run as root)
```

### 6. PM2 management commands

```bash
pm2 status         # Show process status
pm2 logs           # View combined logs
pm2 logs inventorymgr-backend --lines 100  # Backend logs
pm2 logs inventorymgr-frontend --lines 100  # Frontend logs
pm2 restart all    # Restart both services
pm2 stop all       # Stop all services
pm2 kill           # Kill PM2 daemon
```

### 7. Reverse proxy rules

Route browser traffic like this:

- `/api/*` -> backend at `http://127.0.0.1:8000`
- everything else -> Next frontend at `http://127.0.0.1:3000`

The frontend uses `/api` as its API prefix, so browser traffic remains same-origin in production.

### 8. First login

Open `/login` after the backend and frontend are running. If no users exist, the page shows `Create admin account`; create the first admin there. After that, `/login` shows the normal sign-in form.

## Useful commands

```bash
just setup         # install dependencies, initialize DB, run migrations
just db-up         # start PostgreSQL and create local DBs
just api-dev       # run FastAPI with reload on 127.0.0.1:8000
just web-dev       # run Next.js on 127.0.0.1:3000
just verify        # backend lint/tests + frontend typecheck/tests + Playwright

# PM2 production commands (also available via justfile)
just pm2-start     # pm2 start ecosystem.config.js
just pm2-stop      # pm2 stop all
just pm2-restart   # pm2 restart all
just pm2-logs      # pm2 logs
just pm2-status    # pm2 status
just pm2-save      # pm2 save (persist across reboots)
just pm2-startup   # pm2 startup (generate init script)
just pm2-kill      # pm2 kill
```

## API Reference

All endpoints are prefixed with `/api`.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/setup` | Check if admin setup is needed |
| POST | `/auth/setup` | Create first admin account |
| POST | `/auth/login` | Login (sets session cookie) |
| POST | `/auth/logout` | Logout (clears session cookie) |
| GET | `/auth/me` | Get current authenticated user |

### Virtual Machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms` | List VMs (supports `q`, `page`, `page_size`) |
| POST | `/vms` | Create VM |
| GET | `/vms/{vm_id}` | Get VM by ID |
| PATCH | `/vms/{vm_id}` | Update VM |
| DELETE | `/vms/{vm_id}` | Delete VM |

### CSV Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/imports/preview` | Preview CSV import (multipart/form-data) |
| GET | `/imports/{batch_id}` | Get import batch status |
| POST | `/imports/{batch_id}/commit` | Commit previewed import |

### Users (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List all users |
| POST | `/users` | Create user |
| PATCH | `/users/{user_id}` | Update user (role, active status) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check returns `{"status":"ok"}` |

