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
| Backend | Rust 1.98.1, Axum 0.8, SQLx 0.9, PostgreSQL 17 |
| Frontend | Next.js 16, React 19, TanStack Query, Tailwind 4, pnpm 12.14.0, Node.js 24.22.1 LTS |
| Reference oracle | Python 3.14.7 under `backend/`; contract tests only |
| Deploy | Podman rootless Compose or Quadlet units (`quadlet/`) |

## Layout

```
backend-rust/src/{core,db,models,schemas,api}    # Axum handlers and SQLx queries
backend-rust/migrations/                                # Native Alembic-compatible SQL revision chain
backend/                                                # Python 3.14 parity reference
frontend/src/{app,routes,components,hooks,lib,api}
frontend/src/test/                                      # vitest unit tests
frontend/e2e/                                           # Playwright
quadlet/                                                # Podman Quadlet unit files
docs/                                                   # runbook, API reference, alerts, quadlet deploy
```

## Quickstart

Install Rust 1.98.1, Node.js 24.22.1, pnpm 12.14.0, uv (>=0.12.18, e.g. 0.12.24), Podman with Compose,
and `just` before running setup. The repository pins Rust, Python, pnpm, and
container build runtimes; `just setup` checks for the host tools and installs
dependencies from frozen lockfiles and Playwright's Chromium payload. Linux hosts
also need Playwright's Chromium system libraries; provision these before browser
tests (`pnpm exec playwright install-deps chromium` installs them with the
required host privileges). Install cargo-audit 0.22.2 for `just audit`, for example
with `cargo install cargo-audit --version 0.22.2 --locked`. No shell environment
manager is required. For native `just up-local`, install PostgreSQL 17 `pg_dump`
and `pg_restore` clients. `just up` instead builds containers with matching
PostgreSQL clients. The Python oracle is test-only.

Native Rust builds also require a system C linker (`cc`); setup checks it before installing dependencies.

```
just setup          # frozen frontend, oracle, and Rust dependencies
just env            # generate .env from .env.example (JWT_SECRET)
just up-local       # requires PostgreSQL 17 clients; local backend and frontend
just api-dev        # cargo run on :8000
just web-dev        # Next.js development server on :3000
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
| Frontend lint/typecheck | `cd frontend && pnpm run lint` |
| E2E | `just e2e` |
| Full gate before calling anything done | `just verify` |
| Security audit | `just audit` |

`just setup` installs the Python 3.14.7 parity oracle in `backend/.venv` and builds Rust. Production runs only Rust.
`just verify` runs all Cargo tests, including the Podman-backed LDAP/authentication regressions, frontend checks, the HTTP parity suite, three migration startup scenarios with a historical-row preservation assertion, restore concurrency, and the isolated Playwright runner.
`just e2e` creates a disposable Postgres container and starts freshly built backend and frontend processes on allocated ports. It ignores application database URLs, sets a non-default CSRF cookie name after building to exercise runtime configuration, and cleans up only resources it owns. Direct Playwright invocation without the runner is rejected.


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
