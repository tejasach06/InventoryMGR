# AGENTS.md — InventoryMGR

Manual VM/storage/hardware inventory tracker. Postgres backend, no hypervisor
connection — all data is user-entered or CSV-imported.

## Stack

- **Backend**: Rust 1.98 + Axum 0.8 + SQLx 0.9 + Postgres. Python 3.13 under `backend/` is a test-only parity oracle.
- **Frontend**: Next.js 16 (App Router) + React 19 + TanStack Query + Tailwind 4, nub-managed.
- **Deploy**: Podman rootless Compose (`docker-compose.yml`) or Quadlet units (`quadlet/`).

## Layout

- `backend-rust/src/{core,db,schemas,models,services,api}` contains the native backend. `api/{accounts,inventory,auxiliary}` owns route groups.
- `backend-rust/migrations/0001_inventory_schema.sql` contains the native Alembic-compatible revision chain. `alembic_version` remains the ledger at head `0024`.
- `backend/` and `backend/tests/` are retained historical Python parity tooling, not production code.
- `frontend/src/{app,routes,components,hooks,lib,api}` — routes are page-level,
  components are shared, `api/` holds typed fetch wrappers, `lib/` is pure
  helpers.
- `frontend/src/test/` — vitest unit tests. `frontend/e2e/` — Playwright.

## Setup / run

```
just setup          # devbox
just env             # generate .env from .env.example (JWT_SECRET)
just up-local        # db-up + cargo build + nub install/build
just api-dev         # cargo run on :8000
just web-dev         # next dev on :3000
```

## Commands agents will actually need

| Task | Command |
|---|---|
| Backend tests | `just api-test` runs `cargo test --locked` |
| Backend lint | `cd backend-rust && cargo clippy --locked` |
| Frontend unit tests | `just web-test` |
| Frontend lint/typecheck | `cd frontend && nub run --node lint` |
| E2E | `just e2e` uses the isolated Rust browser runner |
| **Full gate before calling anything done** | `just verify` |
| Migrations | Extend the native SQL revision chain and verify `tools/rust-parity/migrations.py`; preserve recognized Alembic upgrade boundaries |

## Conventions an agent must not violate

1. **Native migrations preserve historical revisions.** Maintain the SQL revision chain and the `alembic_version` marker. Do not edit historical Python Alembic files. Test empty and historical upgrade paths.
2. **Backend layering is one-directional.** Keep shared core, database, model, and schema code independent of route handlers. Follow the existing Rust module ownership.
3. **Gitignore lies about some tracked dirs.** `backend/tests/`,
   `frontend/src/test/`, `frontend/e2e/` are gitignored but contain tracked
   files (ignore only blocks *new* careless adds). `git add` a file in one of
   these with `git add -f <specific file>` — never `-f <directory>` (drags in
   `__pycache__`/build junk).
4. **`docs/*` is ignored except an allowlist**: `RUNBOOK.md`, `API.md`,
   `ALERTS.md`, `PODMAN_QUADLET.md`. A new doc file there needs `.gitignore`
   updated first, or belongs elsewhere.
5. **CSV import is the sole VM importer.** Disks format:
   `name:size[:storage_name[:storage_type]]`. Proxmox identity match requires
   both `external_id`/`vmid` AND `name`.
6. **Alerts** are synchronous SQL predicates; `EXCLUDED_TAGS` (`template`,
   `backup`) filtering is case-insensitive.
7. **Admin endpoints** (`/api/settings/ldap`, `/api/settings/app`) require
   `AdminUser`; a plain viewer gets 403 — test both roles when touching them.
   LDAP bind credentials remain encrypted at rest by the Rust backend.
8. Shared UI primitives live in `frontend/src/components/ui.tsx` — reuse
   before adding new component-local styling.
9. Deploy is `./deploy.sh` on `main`: Podman rootless Compose, service-local
   build contexts, `.dockerignore` excludes `.venv`/`node_modules`,
   healthchecks target `127.0.0.1`.

## Ponytail

This repo is worked on in ponytail mode: reuse existing helpers/patterns
before writing new ones, stdlib/native features before deps, no speculative
abstractions. Match existing file conventions over inventing new ones.
