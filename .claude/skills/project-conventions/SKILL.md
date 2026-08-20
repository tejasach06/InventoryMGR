---
name: project-conventions
description: Unwritten repo conventions for InventoryMGR — gitignore/tracked-file quirks, migration workflow, test locations. Background knowledge only.
user-invocable: false
---

# InventoryMGR conventions

## Gitignore vs. tracked files (this trips up `git add`)

Several directories are listed in `.gitignore` but already contain **tracked**
files — the ignore rule only blocks new files from being added carelessly,
not the ones already committed:

- `backend/tests/`, `frontend/src/test/`, `frontend/e2e/` — gitignored per a
  root `.gitignore` comment ("Gitignored on main"), but files inside are
  tracked on `dev`. `git add path/to/tracked/file.py` inside these dirs fails
  with "paths are ignored" even though the file is already tracked — use
  `git add -f <specific file>`, **never** `git add -f <directory>` (that
  sweeps in `__pycache__/*.pyc` and other real garbage the ignore rule was
  protecting against).
- `docs/*` is ignored except an explicit allowlist: `docs/RUNBOOK.md`,
  `docs/API.md`, `docs/ALERTS.md`, `docs/PODMAN_QUADLET.md`. A new file under
  `docs/` (e.g. a design spec) will NOT be trackable without editing
  `.gitignore` first — don't force-add speculative docs there; ask whether
  the file belongs in the allowlist, at the repo root instead, or should stay
  untracked.
- `.claude/settings.json` (but not `.claude/settings.local.json`) is
  explicitly un-ignored — it's meant to be committed and shared with the team.

## Migrations are generated, not hand-written

Use `cd backend && uv run alembic revision --autogenerate -m "description"`,
then review the generated diff and its downgrade path before committing.
Don't hand-edit files under `backend/alembic/versions/` — a PreToolUse hook
blocks Edit/Write there for this reason (see `.claude/settings.json`).

## Backend layering

Dependency order is `core → db → schemas → services → api/routes` — verify
with `grep -rhoE "^from app\.(schemas|db|core|services|api)" <module>
--include="*.py"` before assuming a module is a leaf; `core` is the only
true leaf despite not being alphabetically or conventionally "first".

## Test running

- Backend: `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest` (also `just api-test`).
- Frontend unit: `cd frontend && bun run test` (also `just web-test`).
- Frontend e2e: `cd frontend && bunx playwright test` (also `just e2e`).
- Full gate before considering work done: `just verify`.
