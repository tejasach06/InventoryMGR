# InventoryMGR

A self-hosted inventory tracker for virtual machines, storage, and hardware.

InventoryMGR keeps one trustworthy list of what you run: which VMs exist, what
they are for, who owns them, where their disks live, and which IP addresses they
use. It has **no hypervisor connection**. Everything is entered by hand or
imported from a CSV (including Proxmox and VMware exports), so it works the same
whatever your virtualisation stack looks like.

## What it does

- **VM inventory.** Create, edit, clone, and delete VMs with their disks,
  networks, and applications. Bulk edit, and a guarded bulk delete (explicit row
  selection, a confirmation listing the VM names, and a two-second hold).
  Deletions are audited.
- **Public-to-private IP mappings.** Record which private address a public
  address maps to on the same VM, and carry that through import and export.
- **CSV import and export.** Preview before commit, with conflict resolution.
  CSV is the only VM importer. Export picks the fields you want in XLSX or CSV.
- **Storage and clusters.** Track storage arrays (Synology, NetApp, and so on)
  and cluster groupings independently of VMs.
- **Alerts.** Plain SQL predicates, evaluated when the dashboard loads, flag
  stale shutdowns, overdue decommissions, missing IPs, and duplicate IPs.
  VMs tagged `template` or `backup` are always excluded, case-insensitively.
  A duplicate IP means two running VMs share an address in the same role
  (`private`, `public`, or `backup`). The dashboard, the bell, and the
  `/vms?duplicate_ip=` filter all use one predicate.
- **Users and access.** Session-cookie sign-in with `admin`, `editor`, and
  `viewer` roles, plus optional LDAP bind (credentials are encrypted at rest).
  App-wide and LDAP settings are admin-only.
- **Backups.** Scheduled Postgres backups to a mounted volume using native
  `pg_dump`.

## Quickstart

The fastest way to try it is the containerised stack. You need Podman with
Compose and [`just`](https://github.com/casey/just).

```
just up      # generates .env (with a JWT_SECRET) if needed, then podman compose up -d --build
```

Then open:

- Web app: http://127.0.0.1:3000
- API health: http://127.0.0.1:8000/api/health

### Local development

```
just setup      # frozen frontend, parity harness, and Rust dependencies
just env        # generate .env
just up-local   # local backend and frontend (needs PostgreSQL 17 clients)
just api-dev    # API on :8000
just web-dev    # web app on :3000
```

Toolchain: Rust 1.98.1, Node.js 24.22.3 LTS, pnpm 12.14.0, OpenSSL, Podman with
Compose, and `just`. A system C linker (`cc`) is required for native Rust builds.
`just up-local` also needs PostgreSQL 17 `pg_dump` and `pg_restore`; `just up`
builds containers that already include them. On Linux, install Playwright's
Chromium system libraries before browser tests
(`pnpm exec playwright install-deps chromium`). `just audit` needs
`cargo-audit` 0.22.2 (`cargo install cargo-audit --version 0.22.2 --locked`).
No Python and no shell environment manager are required.

## Common commands

| Task | Command |
|---|---|
| Backend tests | `just api-test` |
| Frontend unit tests | `just web-test` |
| Frontend lint and typecheck | `cd frontend && pnpm run lint` |
| End-to-end tests | `just e2e` |
| Full gate before calling anything done | `just verify` |
| Security audit | `just audit` |
| Deployment check, Compose | `just test-deploy-compose` |
| Deployment check, Quadlet | `just test-deploy-quadlet` |
| Deployment check, both | `just test-deploy` |

`just verify` runs all Cargo tests (including the Podman-backed LDAP and
authentication regressions), the frontend checks, the HTTP parity suite, three
migration startup scenarios with a historical-row preservation assertion,
restore concurrency, and the isolated Playwright runner.

`just e2e` starts a disposable Postgres container and freshly built backend and
frontend processes on allocated ports. It ignores application database URLs,
sets a non-default CSRF cookie name to exercise runtime configuration, and
cleans up only resources it owns. Running Playwright directly, without the
runner, is rejected.

## Deployment

`./deploy.sh` deploys `main` with Podman rootless Compose. Build contexts are
service-local, `target` and `node_modules` are excluded, and healthchecks use
`127.0.0.1`. Quadlet unit files are in `quadlet/`.

`just test-deploy` builds the images on a Linux build host, transfers the exact
images to the Aspire test host, and verifies both Compose and Quadlet there. It
refuses to run if InventoryMGR resources already exist, rather than stopping or
replacing them. For SSH and host prerequisites, private evidence, and cleanup
behaviour, see the
[deployment verification runbook](docs/RUNBOOK.md#deployment-verification).

## How it is built

| Layer | Tech |
|---|---|
| Backend | Rust, Axum 0.8, SQLx 0.9, PostgreSQL 17 |
| Frontend | Next.js 16, React 19, TanStack Query, Tailwind 4 |
| Regression harness | Rust (`tools/parity/`), with frozen HTTP and migration baselines |
| Deploy | Podman rootless Compose, or Quadlet units |

Database migrations are a native SQL chain that stays compatible with the old
Alembic history. The `alembic_version` table is the ledger, and the current head
is `0028`.

## Repository layout

```
backend-rust/       Axum API: src/{core,db,models,schemas,api}, migrations/
frontend/           Next.js app: src/{app,routes,components,hooks,lib,api}
tools/parity/       Rust parity harness and frozen baselines
tools/              e2e runners, deployment verifier, risk-acceptance checks
quadlet/            Podman Quadlet unit files
docs/               Runbook, API reference, alerts, Quadlet deploy
```

Per-area guides: [backend-rust](backend-rust/AGENTS.md),
[frontend](frontend/AGENTS.md), [postgres](postgres/AGENTS.md),
[tools/parity](tools/parity/AGENTS.md).

## Documentation

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md): operating the deployed stack (startup,
  backups, restore, troubleshooting, migration log).
- [`docs/API.md`](docs/API.md): REST API reference.
- [`docs/ALERTS.md`](docs/ALERTS.md): alert predicate reference.
- [`docs/PODMAN_QUADLET.md`](docs/PODMAN_QUADLET.md): Quadlet-based deployment.
- [`AGENTS.md`](AGENTS.md): conventions for agents and contributors.

## License

MIT. See [`LICENSE`](LICENSE).
