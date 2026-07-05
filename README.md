# InventoryMGR

InventoryMGR is a full-stack virtual machine inventory application for small and medium businesses managing 50–500 VMs. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based authentication, role-based access control, and a complete VM lifecycle documentation workflow — without connecting to any hypervisor.

## Stack

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, TanStack Query
- **Tooling**: devbox, uv, bun, just, pytest, Vitest, Playwright

## Features

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
- CSV export of all VMs or a filtered subset.
- CSV import with preview, column mapping, duplicate detection, and error report.
- Admin-only user management.

## Project layout

```text
backend/     FastAPI app, database models, Alembic migrations, pytest tests
frontend/    Next.js app, API client, UI routes, unit and E2E tests
justfile     Common local commands
devbox.json  Development runtime and PostgreSQL scripts
docs/        CONTRIBUTING.md (setup, scripts, testing) · RUNBOOK.md (deployment, ops)
```

## Quick start

Requires [devbox](https://www.jetify.com/devbox).

```bash
devbox shell
just setup      # install deps, init DB, run migrations

just api-dev    # FastAPI on :8000
just web-dev    # Next.js on :3000
```

Open `http://127.0.0.1:3000`. On a fresh database `/login` shows **Create admin account**.

If setup has already run and you just need to start the services:

```bash
just db-up
just api-dev
just web-dev
```

### Tests

```bash
just api-test   # pytest (backend)
just web-test   # Vitest (frontend)
just e2e        # Playwright end-to-end

just verify     # all of the above + lint + typecheck
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full command reference.

## Contributing

Contributions are welcome. Please read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for local setup and testing guidance, then open an issue or pull request with a clear summary of the change.

## License

This project is licensed under the [MIT License](LICENSE).

## Configuration

Copy the example file and edit secrets before running outside local development:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `APP_ENV` | No | `development`, `test`, or `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes (prod) | Must be 32+ random bytes in production |
| `APP_CORS_ORIGINS` | No | Comma-separated frontend origins |
| `UPLOAD_DIR` | No | File attachment storage (default: `/data/uploads`) |

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for the full environment variable reference.

## Docker

`docker-compose.yml` defines three services: `db` (Postgres 16), `backend` (:8000), `frontend` (:3000).

```bash
docker compose up -d
```

For E2E tests in Docker (no local services needed):

```bash
docker compose -f docker-compose.e2e.yml run --rm playwright
```

## Deployment

See **[docs/RUNBOOK.md](docs/RUNBOOK.md)** for the complete PM2 deployment guide, health checks, common issues, and rollback procedures.

## API Reference

All routes are prefixed with `/api`. Authentication uses a session cookie set on `POST /api/auth/login`.

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
| GET | `/vms/{vm_id}/networks` | List network interfaces |
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
| POST | `/vms/{vm_id}/attachments` | Upload file |
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
| GET | `/reports/{report_name}` | Download predefined CSV report |

### CSV Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/imports/preview` | Upload CSV and get import preview |
| GET | `/imports/{batch_id}` | Get import batch details |
| POST | `/imports/{batch_id}/commit` | Commit an import batch |

### Users (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users |
| POST | `/users` | Create user |
| PATCH | `/users/{user_id}` | Update user |

### Settings (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings/options` | Grouped dropdown options for all categories |
| GET | `/settings/options/all` | Flat list of all options |
| POST | `/settings/options` | Create dropdown option |
| PATCH | `/settings/options/{option_id}` | Update dropdown option |
| DELETE | `/settings/options/{option_id}` | Delete dropdown option |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Returns `{"status":"ok"}` |
