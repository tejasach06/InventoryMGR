# InventoryMGR

Manual VM, storage, and hardware inventory tracker. Postgres-backed, no
hypervisor connection — all data is user-entered or CSV-imported (Proxmox/VMware
exports).

## Features

- **VM inventory** — CRUD for VMs with disks, networks, applications; bulk edit;
  CSV import with preview/commit and conflict resolution.
- **Storage & clusters** — track storage arrays (Synology, NetApp, …) and
  cluster groupings independently of VMs.
- **Alerts** — synchronous SQL predicates flag inventory issues (e.g. stale
  environments), case-insensitively excluding `template`/`backup`-tagged VMs.
- **Reports** — CSV/XLSX export of inventory fields.
- **Users & auth** — JWT session-cookie auth, role-based access
  (`admin`/`editor`/`viewer`), optional LDAP bind (credentials encrypted at rest).
- **Settings** — app-wide settings and LDAP configuration, admin-only.
- **Backups** — scheduled Postgres backups to a mounted volume.

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, SQLAlchemy 2, Alembic, Postgres (psycopg), `uv`, Python 3.13 |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Tailwind 4, Bun |
| Deploy | Podman rootless Compose or Quadlet units (`quadlet/`) |

## Layout

```
backend/app/{core,db,schemas,services,api}   # core → db → schemas → services → api/routes
backend/alembic/versions/                    # generated migrations, never hand-edit
backend/tests/                               # pytest
frontend/src/{app,routes,components,hooks,lib,api}
frontend/src/test/                           # vitest unit tests
frontend/e2e/                                # Playwright
quadlet/                                     # Podman Quadlet unit files
docs/                                        # runbook, API reference, alerts, quadlet deploy
```

## Quickstart

```
just setup          # devbox environment
just env            # generate .env from .env.example (JWT_SECRET)
just up-local        # db-up + uv sync + bun install
just api-dev         # uvicorn --reload on :8000
just web-dev         # next dev on :3000
```

Or run the full stack in containers:

```
just up              # podman compose up -d --build
```

Frontend: http://127.0.0.1:3000 · API: http://127.0.0.1:8000/api/health

## Common commands

| Task | Command |
|---|---|
| Backend tests | `just api-test` |
| Backend lint | `cd backend && uv run ruff check app tests` |
| Frontend unit tests | `just web-test` |
| Frontend lint/typecheck | `cd frontend && bun run lint` |
| E2E | `just e2e` |
| Full gate before calling anything done | `just verify` |
| New migration | `cd backend && uv run alembic revision --autogenerate -m "..."` |

## Documentation

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operating the deployed stack: startup,
  backups, restore, troubleshooting.
- [`docs/API.md`](docs/API.md) — REST API reference.
- [`docs/ALERTS.md`](docs/ALERTS.md) — alert predicate reference.
- [`docs/PODMAN_QUADLET.md`](docs/PODMAN_QUADLET.md) — Quadlet-based deployment.
- [`AGENTS.md`](AGENTS.md) — conventions for agents/contributors working in this repo.

## Deployment

`./deploy.sh` deploys `main` via Podman rootless Compose (service-local build
contexts, `.venv`/`node_modules` excluded, healthchecks against `127.0.0.1`).
See `docs/RUNBOOK.md` and `docs/PODMAN_QUADLET.md` for details.

## License

MIT — see [`LICENSE`](LICENSE).
