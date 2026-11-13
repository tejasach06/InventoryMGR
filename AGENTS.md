# AGENTS.md — InventoryMGR

Manual VM/storage/hardware inventory tracker. Postgres backend, no hypervisor
connection — all data is user-entered or CSV-imported.

## Stack

- **Backend**: Rust 1.98.1 + Axum 0.8 + SQLx 0.9 + PostgreSQL 17. The regression harness (`tools/parity/`) is also Rust.
- **Frontend**: Next.js 16 (App Router) + React 19 + TanStack Query + Tailwind 4, pnpm 12.14.0 on Node.js 24 LTS.
- **Deploy**: Podman rootless Compose (`docker-compose.yml`) or Quadlet units (`quadlet/`).

## Layout

- `backend-rust/src/{core,db,schemas,models,api}` contains the native backend. `api/{accounts,inventory,auxiliary}` owns route groups.
- `backend-rust/migrations/0001_inventory_schema.sql` contains the native Alembic-compatible revision chain. `alembic_version` remains the ledger at head `0024`.
- `frontend/src/{app,routes,components,hooks,lib,api}` — routes are page-level,
  components are shared, `api/` holds typed fetch wrappers, `lib/` is pure
  helpers.
- `frontend/src/test/` — vitest unit tests. `frontend/e2e/` — Playwright.

## Scoped agent guides

- `backend-rust/AGENTS.md` covers the Rust backend and its image.
- `frontend/AGENTS.md` covers the Next.js app and its image.
- `postgres/AGENTS.md` covers the custom PostgreSQL image.
- `tools/parity/AGENTS.md` covers frozen API and migration comparisons.

## Setup / run

```
just setup          # install from frozen lockfiles; requires host Rust, Node, pnpm, OpenSSL, Podman
just env            # generate .env from .env.example (JWT_SECRET)
just up-local       # requires native PostgreSQL 17 clients for backup and restore
just api-dev        # cargo run on :8000
just web-dev        # Next.js development server on :3000
```

## Commands agents will actually need

| Task | Command |
|---|---|
| Backend tests | `just api-test` runs `cargo test --locked` |
| Backend lint | `cd backend-rust && cargo clippy --locked` |
| Frontend unit tests | `just web-test` |
| Frontend lint/typecheck | `cd frontend && pnpm run lint` |
| E2E | `just e2e` uses the isolated Rust browser runner |
| **Full gate before calling anything done** | `just verify` |
| Migrations | Extend the native SQL revision chain and verify `cd tools/parity && cargo run --locked --bin parity -- migrations --rust-binary <path> --output <dir>`; preserve recognized Alembic upgrade boundaries |

## Conventions an agent must not violate

1. **Native migrations preserve historical revisions.** Maintain the SQL revision chain and the `alembic_version` marker. Test empty and historical upgrade paths against the frozen baselines in `tools/parity/`.
2. **Backend layering is one-directional.** Keep shared core, database, model, and schema code independent of route handlers. Follow the existing Rust module ownership.
3. **Gitignore lies about some tracked dirs.** `frontend/src/test/`,
   `frontend/e2e/` are gitignored but contain tracked
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
   healthchecks target `127.0.0.1`. The backend Dockerfile builds with Rust
   and runs on Debian Trixie; the frontend builds Next.js standalone output
   with Node.js and runs it in a Node.js image; the PostgreSQL Dockerfile
   builds `gosu` with Go and copies it into the PostgreSQL 17 Alpine image.
   Keep build tools out of these final stages.

## Ponytail

This repo is worked on in ponytail mode: reuse existing helpers/patterns
before writing new ones, stdlib/native features before deps, no speculative
abstractions. Match existing file conventions over inventing new ones.

## Agent skills

### Codebase research

When Graphify is installed and an existing graph is available, query it first
for code relationships and change impact. Verify graph results against current
source because the graph may be stale. Graphify files are local-only; if the
skill, CLI, or graph is unavailable, use focused source searches instead.

### Issue tracker

GitHub Issues (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels, each equal to its role name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.
