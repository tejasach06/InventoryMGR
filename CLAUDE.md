# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` at the repo root is the canonical agent guide. Read it first, then the scoped guides: `backend-rust/AGENTS.md`, `frontend/AGENTS.md`, `postgres/AGENTS.md`, `tools/parity/AGENTS.md`.

## What this is

Manual VM/storage/hardware inventory tracker. Postgres backend, no hypervisor connection: all data is user-entered or CSV-imported.

- Backend: Rust + Axum 0.8 + SQLx 0.9 + PostgreSQL 17 (`backend-rust/`). The regression harness `tools/parity/` is also Rust.
- Frontend: Next.js 16 (App Router) + React 19 + TanStack Query + Tailwind 4, pnpm on Node 24 (`frontend/`).
- Deploy: Podman rootless Compose (`docker-compose.yml`, `./deploy.sh` on `main`) or Quadlet units (`quadlet/`).

## Commands

All via `just` (see `justfile`):

- `just setup` installs from frozen lockfiles. `just env` generates `.env`.
- `just up-local` starts the stack locally. `just api-dev` serves the API on :8000. `just web-dev` serves the web app on :3000.
- `just api-test` runs `cargo test --locked` in `backend-rust/`. Single test: `cd backend-rust && cargo test --locked <name>`.
- `just web-test` runs vitest (`pnpm run test`). Single file: `cd frontend && pnpm exec vitest run src/test/<file>`.
- Lint: `cd backend-rust && cargo clippy --locked`; `cd frontend && pnpm run lint` (eslint + `tsc --noEmit`).
- `just e2e` runs the isolated Rust browser runner (`tools/run-rust-e2e.sh`).
- `just verify` is the full gate. Run it before calling work done.
- Deploy checks: `just test-deploy [compose|quadlet]`.

## Architecture

- Backend layering is one-directional: `core`, `db`, `models`, `schemas` must not depend on `api` route handlers. Route groups live in `backend-rust/src/api/{accounts,inventory,auxiliary}`.
- Migrations are a native SQL chain in `backend-rust/migrations/` that stays compatible with the old Alembic history. `alembic_version` is still the ledger (head `0026`). Never rewrite historical revisions. Extend the chain and verify with `tools/parity` (`cargo run --locked --bin parity -- migrations --rust-binary <path> --output <dir>`).
- Frontend: `routes/` are page-level, `components/` shared, `api/` typed fetch wrappers, `lib/` pure helpers. Reuse primitives in `components/ui.tsx` before adding new styling.

## Gotchas

- `frontend/src/test/` and `frontend/e2e/` are gitignored but contain tracked files. Add with `git add -f <specific file>`, never `-f <directory>`.
- `docs/*` is gitignored except `RUNBOOK.md`, `API.md`, `ALERTS.md`, `PODMAN_QUADLET.md`. Update `.gitignore` before adding another doc there.
- CSV import is the only VM importer. Disks format: `name:size[:storage_name[:storage_type]]`. Proxmox identity match needs both `external_id`/`vmid` AND `name`.
- Alerts are synchronous SQL predicates. `EXCLUDED_TAGS` (`template`, `backup`) filtering is case-insensitive.
- `/api/settings/ldap` and `/api/settings/app` require `AdminUser`. Test both admin and viewer (403) when touching them.
- Keep build tools out of the final stages of the backend, frontend and postgres Dockerfiles.

## Workflow

- Reuse existing helpers and patterns; no speculative abstractions.
- Release: deploy a PR to Aspire for verification and the user's browser check, with a security audit before merge. Never merge to `main` without a separate explicit instruction.
- Graphify: query an existing graph first for code relationships, then verify against source (see `.claude/CLAUDE.md`).
- Issues use GitHub Issues via `gh`. Domain docs: `GLOSSARY.md`, `docs/adr/`.
