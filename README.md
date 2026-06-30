# InventoryMGR

InventoryMGR is a full-stack virtual machine inventory application for small and medium businesses managing 50–500 VMs. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based authentication, role-based access control, and a complete VM lifecycle documentation workflow — without connecting to any hypervisor.

## Stack

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, TanStack Query
- **Tooling**: devbox, uv, bun, just, pytest, Vitest, Playwright

## Main features

- First-deployment admin account creation from the login page.
- Session-cookie authentication with CSRF protection for state-changing requests.
- Roles: `admin`, `editor`, and `viewer`.
- VM inventory with full CRUD — create, edit, clone, archive, delete.
- Per-VM sub-resources managed inline on the detail page:
  - Unlimited disks (name, storage, size, type)
  - Unlimited network interfaces (IPv4, VLAN, gateway)
  - Multiple applications per VM (name, owner, description)
  - File attachments (PDF, DOCX, XLSX, PNG, JPG, ZIP — up to 50 MB each)
- Documentation health score (0–100) based on completeness of key fields.
- Audit log recording every field change with old/new values and the acting user.
- Dashboard with 9 infrastructure summary cards and recently added VMs.
- 8 predefined downloadable CSV reports (Linux, Windows, Production, Monitoring, etc.).
- CSV export of all VMs or filtered results.
- CSV import with preview, column mapping, duplicate detection, and error report.
- Admin-only user management.

## Project layout

```text
backend/   FastAPI app, database models, Alembic migrations, pytest tests
frontend/  Next.js app, API client, UI routes, unit and E2E tests
justfile   Common local commands
devbox.json Development runtime and PostgreSQL scripts
docs/      CONTRIBUTING.md (setup, scripts, testing) · RUNBOOK.md (deployment, ops)
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
| `UPLOAD_DIR` | Directory where VM file attachments are stored (default: `/data/uploads`) |

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

## Docker

Dockerfile for the backend is at `backend/Dockerfile`, for the frontend at `frontend/Dockerfile`. `docker-compose.yml` defines three services: `db` (Postgres 16), `backend`, and `frontend`.

```bash
docker compose build
docker compose up -d
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
UPLOAD_DIR=/data/uploads
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
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 6. PM2 management

```bash
pm2 status
pm2 logs
pm2 restart all
pm2 stop all
```

### 7. Reverse proxy rules

Route traffic like this:

- `/api/*` → backend at `http://127.0.0.1:8000`
- everything else → Next.js frontend at `http://127.0.0.1:3000`

### 8. First login

Open `/login` after services are running. If no users exist, the page shows `Create admin account`.

## Useful commands

```bash
just setup         # install dependencies, initialize DB, run migrations
just db-up         # start PostgreSQL
just api-dev       # FastAPI dev server on :8000
just web-dev       # Next.js dev server on :3000
just verify        # lint, typecheck, unit tests, Playwright

just pm2-start
just pm2-stop
just pm2-restart
just pm2-logs
just pm2-status
just pm2-save
just pm2-startup
just pm2-kill
```

## API Reference

All endpoints are prefixed with `/api`.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/setup` | Check if admin setup is needed |
| POST | `/auth/setup` | Create first admin account |
| POST | `/auth/login` | Login (sets session cookie) |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Current user |

### Virtual Machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms` | List VMs (`q`, `platform`, `status`, `environment`, `criticality`, `lifecycle`, `monitoring_enabled`, `health`, `limit`, `offset`) |
| POST | `/vms` | Create VM |
| GET | `/vms/owners` | List distinct owner names |
| GET | `/vms/{vm_id}` | Get VM with all sub-resources |
| PATCH | `/vms/{vm_id}` | Update VM |
| DELETE | `/vms/{vm_id}` | Delete VM |
| POST | `/vms/{vm_id}/clone` | Clone VM record |
| GET | `/vms/export` | Stream filtered VMs as CSV (`status`, `health`, `ids`) |

### Disks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/disks` | List disks |
| POST | `/vms/{vm_id}/disks` | Add disk |
| PATCH | `/vms/{vm_id}/disks/{disk_id}` | Update disk |
| DELETE | `/vms/{vm_id}/disks/{disk_id}` | Delete disk |

### Network Interfaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/networks` | List interfaces |
| POST | `/vms/{vm_id}/networks` | Add interface |
| PATCH | `/vms/{vm_id}/networks/{network_id}` | Update interface |
| DELETE | `/vms/{vm_id}/networks/{network_id}` | Delete interface |

### Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/applications` | List applications |
| POST | `/vms/{vm_id}/applications` | Add application |
| PATCH | `/vms/{vm_id}/applications/{app_id}` | Update application |
| DELETE | `/vms/{vm_id}/applications/{app_id}` | Delete application |

### Attachments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/attachments` | List attachments |
| POST | `/vms/{vm_id}/attachments` | Upload file (max 50 MB) |
| GET | `/vms/{vm_id}/attachments/{attachment_id}/download` | Download file |
| DELETE | `/vms/{vm_id}/attachments/{attachment_id}` | Delete attachment |

### Audit Log

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/audit` | Audit log entries (`limit`, `offset`) |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Infrastructure summary and recently added VMs |

### Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports` | List predefined reports |
| GET | `/reports/{report_name}` | Download report as CSV |

### CSV Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/imports/preview` | Preview CSV (multipart/form-data) |
| GET | `/imports/{batch_id}` | Import batch status |
| POST | `/imports/{batch_id}/commit` | Commit import |

### Users (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users |
| POST | `/users` | Create user |
| PATCH | `/users/{user_id}` | Update user |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings/options` | Grouped dropdown options for all categories |
| GET | `/settings/options/all` | Flat list of all options (admin) |
| POST | `/settings/options` | Create dropdown option (admin) |
| PATCH | `/settings/options/{option_id}` | Update dropdown option (admin) |
| DELETE | `/settings/options/{option_id}` | Delete dropdown option (admin) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Returns `{"status":"ok"}` |
