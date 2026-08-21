# InventoryMGR

InventoryMGR is a full-stack virtual machine inventory application for small and medium businesses managing 50–500 VMs. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based authentication, role-based access control, and a complete VM lifecycle documentation workflow — without connecting to any hypervisor.

## Stack

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, TanStack Query
- **Tooling**: devbox, uv, nub, just, pytest, Vitest, Playwright

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
 - CSV import with preview, per-row change detail, duplicate detection, and error report. Supports all importable VM fields including `vm_type`, role-scoped IP columns (`private_ip`, `public_ip`, `backup_ip` as semicolon-separated addresses), `applications` (`name[:owner]` entries separated by `;`), and disk cells (`name:size[:storage_name[:storage_type]]` entries separated by `;`). Imports only ever add disks, IPs, and applications; blank cells never clear a field.
 - Light/dark theme plus a per-user accent color (six presets), persisted server-side.
 - Per-user saved column preferences per page, and bulk edit across selected or all matching VMs.
 - Admin-only user management.
## Project layout

```text
backend/     FastAPI app, database models, Alembic migrations, pytest tests
frontend/    Next.js app, API client, UI routes, unit and E2E tests
justfile     Common local commands
devbox.json  Development runtime and PostgreSQL scripts
docs/        API.md (endpoint reference) · CONTRIBUTING.md (setup, scripts, testing) · RUNBOOK.md (deployment, ops) · ALERTS.md (alert rules, tag suppression)
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

Run `just up` (podman) or `just up-local` (PM2) to deploy. See [docs/RUNBOOK.md](docs/RUNBOOK.md) for details, health checks, common issues, and rollback procedures.

## API Reference

See [docs/API.md](docs/API.md) for the full endpoint reference. All routes are prefixed with `/api`; authentication uses a session cookie set on `POST /api/auth/login`.

## Contributing

Contributions are welcome. Please read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for local setup and testing guidance, then open an issue or pull request with a clear summary of the change.

## License

This project is licensed under the [MIT License](LICENSE).
