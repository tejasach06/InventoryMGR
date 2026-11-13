# Backend Rust agent instructions

The root `AGENTS.md` contains project-wide rules. This guide covers the native
Rust API in this directory.

## Structure

- `src/api/` owns Axum routes and request handling.
- `src/core/`, `src/db/`, `src/models/`, and `src/schemas/` hold shared backend
  code. Keep dependencies pointed toward these modules, not from them into
  route handlers.
- `migrations/0001_inventory_schema.sql` contains the native SQL revision
  chain. `alembic_version` remains the ledger at head `0024`.

## Changes and checks

- Preserve historical migrations. Check both empty and historical upgrades
  with the frozen cases in `../tools/parity/` when changing migrations.
- Keep PostgreSQL client tools in the runtime image. The backend uses
  `pg_dump` and `pg_restore` for backups.
- Run `cargo test --locked` for backend tests. Run
  `cargo clippy --locked` for lint checks.

## Container image

`Dockerfile` builds the release binary with the pinned Rust image, then copies
it into a Debian Trixie runtime with PostgreSQL 17 clients, curl, and
certificates. The runtime uses the unprivileged `appuser` account. Keep the
compiler and Cargo out of the runtime stage.
