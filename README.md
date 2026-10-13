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
- **Backups** — scheduled Postgres backups to a mounted volume via native pg_dump.

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust 1.98, Axum 0.8, SQLx 0.9, Postgres |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Tailwind 4, nub; Node 26 in Devbox and Node 24 in container |
| Reference Oracle | Python 3.13 parity reference under `backend/` for contract verification |
| Deploy | Podman rootless Compose or Quadlet units (`quadlet/`) |

## Layout

```
backend-rust/src/{core,db,models,schemas,api}    # Axum handlers and SQLx queries
backend-rust/migrations/                                # Native Alembic-compatible SQL revision chain
backend/                                                # Parity reference oracle (Python 3.13)
frontend/src/{app,routes,components,hooks,lib,api}
frontend/src/test/                                      # vitest unit tests
frontend/e2e/                                           # Playwright
quadlet/                                                # Podman Quadlet unit files
docs/                                                   # runbook, API reference, alerts, quadlet deploy
```

## Quickstart

```
just setup          # devbox environment
just env            # generate .env from .env.example (JWT_SECRET)
just up-local       # db-up + cargo build + nub install/build
just api-dev        # cargo run on :8000
just web-dev        # next dev on :3000
```

Or run the full stack in containers:

```
just up             # podman compose up -d --build
```

Frontend: http://127.0.0.1:3000 · API: http://127.0.0.1:8000/api/health

## Common commands

| Task | Command |
|---|---|
| Backend tests | `just api-test` |
| Frontend unit tests | `just web-test` |
| Frontend lint/typecheck | `cd frontend && nub run --node lint && nub run --node typecheck` |
| E2E | `just e2e` |
| Full gate before calling anything done | `just verify` |
| Security audit | `just audit` |

`just setup` provisions Python 3.13 and the `backend/.venv` parity oracle as test-only tooling. Production runs only Rust.
`just verify` runs Cargo tests, frontend checks, the 237-case HTTP parity suite, three migration startup scenarios with a historical-row preservation assertion, restore concurrency, and the isolated Playwright runner.
`just e2e` creates a disposable Postgres container and starts freshly built backend and frontend processes on allocated ports. It ignores application database URLs and cleans up only resources it owns. Direct Playwright invocation without the runner is rejected.


## Documentation

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operating the deployed stack: startup,
  backups, restore, troubleshooting, and migration log.
- [`docs/API.md`](docs/API.md) — REST API reference.
- [`docs/ALERTS.md`](docs/ALERTS.md) — alert predicate reference.
- [`docs/PODMAN_QUADLET.md`](docs/PODMAN_QUADLET.md) — Quadlet-based deployment.
- [`AGENTS.md`](AGENTS.md) — conventions for agents/contributors working in this repo.

## Deployment

`./deploy.sh` deploys `main` via Podman rootless Compose (service-local build
contexts, `target`/`node_modules` excluded, healthchecks against `127.0.0.1`).
See `docs/RUNBOOK.md` and `docs/PODMAN_QUADLET.md` for details.

## License

MIT — see [`LICENSE`](LICENSE).
