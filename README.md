# InventoryMGR

InventoryMGR is a full-stack virtual machine inventory application for small and medium businesses managing 50–500 VMs. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based authentication, role-based access control, and a complete VM lifecycle documentation workflow — without connecting to any hypervisor.

## Stack

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, TanStack Query
- **Tooling**: devbox, uv, bun, just, pytest, Vitest, Playwright

## Features

 - First-deployment admin account creation from the login page.
 - Session-cookie authentication with CSRF protection for state-changing requests.
 - LDAP/Active Directory authentication with group-to-role mapping, configured in Settings (admin-only).
 - Roles: `admin`, `editor`, and `viewer`.
 - VM inventory with full CRUD — create, edit, clone, archive, delete.
 - Per-VM sub-resources managed inline on the detail page:
   - Unlimited disks (name, storage, size, type)
   - Unlimited network interfaces (IPv4, VLAN, gateway)
   - Multiple applications per VM (name, owner, description)
 - Storage inventory: arrays → volumes → LUNs/shares, with capacity warning threshold (`storage_usage_warn_pct`).
 - Physical cluster inventory with nodes.
 - Decommission notification bell driven by `decommission_notify_days`.
 - Documentation health score (0–100) based on completeness of key fields.
 - Audit log recording every field change with old/new values and the acting user.
 - Dashboard with 9 infrastructure summary cards and recently added VMs.
 - 8 predefined downloadable CSV reports (Linux, Windows, Production, Monitoring, etc.).
 - CSV/XLSX export of all VMs or a filtered subset (`format=csv` or `format=xlsx`).
 - CSV import with preview, per-row change detail, duplicate detection, and error report. Supports all VM fields including `vm_type`, `applications` (`Name;Owner;Desc`), extended disk cell format (`Name:Storage:Size:Type`), and IP cell format (`IP/VLAN/Role/GW`). Imports only ever add disks, IPs, and applications; blank cells never clear a field.
 - Light/dark theme plus a per-user accent color (six presets), persisted server-side.
 - Per-user saved column preferences per page, and bulk edit across selected or all matching VMs.
 - Admin-only user management.
## Project layout

```text
backend/     FastAPI app, database models, Alembic migrations, pytest tests
frontend/    Next.js app, API client, UI routes, unit and E2E tests
justfile     Common local commands
devbox.json  Development runtime and PostgreSQL scripts
docs/        CONTRIBUTING.md (setup, scripts, testing) · RUNBOOK.md (deployment, ops) · wiki/ALERTS.md (alert rules, tag suppression)
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

Run `just up` (podman) or `just up-local` (PM2) to deploy. See **[docs/RUNBOOK.md](docs/RUNBOOK.md)** for details, health checks, common issues, and rollback procedures.

## API Reference

All routes are prefixed with `/api`. Authentication uses a session cookie set on `POST /api/auth/login`.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/setup` | Check if admin setup is needed |
| POST | `/auth/setup` | Create first admin account |
| POST | `/auth/login` | Login (sets session cookie) |
| POST | `/auth/logout` | Logout |
| POST | `/auth/refresh` | Rotate the session cookie |

### Virtual Machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms` | List VMs (`q`, `platform`, `status`, `environment`, `criticality`, `lifecycle`, `vm_type`, `monitoring_enabled`, `health`, `sort_by`, `sort_order`, `limit`, `offset`) |
| POST | `/vms` | Create VM |
| GET | `/vms/clusters` | List distinct cluster names |
| GET | `/vms/nodes` | List distinct node names |
| GET | `/vms/applications` | List distinct application names |
| GET | `/vms/tags` | List distinct tag names |
| GET | `/vms/owners` | List distinct owner names |
| GET | `/vms/{vm_id}` | Get VM with all sub-resources |
| PATCH | `/vms/{vm_id}` | Update VM |
| DELETE | `/vms/{vm_id}` | Delete VM |
| POST | `/vms/{vm_id}/clone` | Clone VM record |
| GET | `/vms/export` | Stream filtered VMs as CSV or XLSX (`status`, `health`, `ids`, `format=csv|xlsx`) |
| POST | `/vms/bulk` | Bulk update matching or selected VMs (`patch`, `filters`, `all_matching`, `vm_ids`) |

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
| GET | `/reports/summary` | Fleet totals and grouped counts (`total_vms`, `counts`) |
| GET | `/reports/{report_name}` | Download predefined CSV report |

### CSV Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/imports/template` | Download a CSV template with every importable header |
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
| GET | `/settings/app` | App settings (`decommission_notify_days`, `storage_usage_warn_pct`) |
| PATCH | `/settings/app` | Update app settings |
| GET | `/settings/ldap` | LDAP config (bind password returned only as `bind_password_set: bool`) |
| PUT | `/settings/ldap` | Replace LDAP config |
| POST | `/settings/ldap/test` | Test bind/search, optionally with a username+password |
| GET | `/settings/options` | Grouped dropdown options for all categories |
| GET | `/settings/options/all` | Flat list of all options |
| POST | `/settings/options` | Create dropdown option |
| PATCH | `/settings/options/{option_id}` | Update dropdown option |
| DELETE | `/settings/options/{option_id}` | Delete dropdown option |

### Storage

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/storage/arrays` | List storage arrays |
| POST | `/storage/arrays` | Create storage array |
| GET | `/storage/arrays/{array_id}` | Get storage array with child volumes |
| PATCH | `/storage/arrays/{array_id}` | Update storage array |
| DELETE | `/storage/arrays/{array_id}` | Delete storage array |
| GET | `/storage/arrays/{parent_id}/volumes` | List volumes for an array |
| POST | `/storage/arrays/{parent_id}/volumes` | Create volume in an array |
| PATCH | `/storage/arrays/{parent_id}/volumes/{item_id}` | Update volume |
| DELETE | `/storage/arrays/{parent_id}/volumes/{item_id}` | Delete volume |
| GET | `/storage/volumes/{parent_id}/luns` | List LUNs for a volume |
| POST | `/storage/volumes/{parent_id}/luns` | Create LUN in a volume |
| PATCH | `/storage/volumes/{parent_id}/luns/{item_id}` | Update LUN |
| DELETE | `/storage/volumes/{parent_id}/luns/{item_id}` | Delete LUN |
| GET | `/storage/volumes/{parent_id}/shares` | List shares for a volume |
| POST | `/storage/volumes/{parent_id}/shares` | Create share in a volume |
| PATCH | `/storage/volumes/{parent_id}/shares/{item_id}` | Update share |
| DELETE | `/storage/volumes/{parent_id}/shares/{item_id}` | Delete share |

### Physical Clusters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters` | List physical clusters |
| POST | `/clusters` | Create physical cluster |
| GET | `/clusters/{cluster_id}` | Get cluster with child nodes |
| PATCH | `/clusters/{cluster_id}` | Update physical cluster |
| DELETE | `/clusters/{cluster_id}` | Delete physical cluster |
| GET | `/clusters/{parent_id}/nodes` | List nodes for a cluster |
| POST | `/clusters/{parent_id}/nodes` | Create node in a cluster |
| PATCH | `/clusters/{parent_id}/nodes/{item_id}` | Update node |
| DELETE | `/clusters/{parent_id}/nodes/{item_id}` | Delete node |

### User Preferences

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/accent` | Current user's accent preset |
| PUT | `/user/accent` | Set accent — one of `orange`, `blue`, `violet`, `emerald`, `rose`, `amber` |
| GET | `/user/preferences/{page_key}` | Saved column preferences for a page |
| PUT | `/user/preferences/{page_key}` | Save column preferences |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications/decommissions` | VMs due for decommission within the configured window |
| POST | `/notifications/decommissions/ack` | Acknowledge the current decommission notifications |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Returns `{"status":"ok"}` |
