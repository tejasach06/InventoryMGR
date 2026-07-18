# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All work happens inside `devbox shell`. Task runner is `just` (see `justfile`).

```bash
just setup      # uv sync + bun install + alembic upgrade head (needs Postgres up first)
just db-up      # start Postgres 16 on :54329 via docker-compose.e2e-db.yml
just api-dev    # uvicorn on 127.0.0.1:8000 --reload
just web-dev    # Next.js on 127.0.0.1:3000

just api-test   # pytest (backend, uses $TEST_DATABASE_URL)
just web-test   # Vitest (frontend)
just e2e        # Playwright
just verify     # ruff + pytest + lint + typecheck + vitest + playwright — run before any PR
just audit      # bun audit + uv audit + typecheck + ruff + tools/check-accepted-risks.sh
```

Single test:

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vm_filters.py::test_name
cd frontend && bun run test src/test/InventoryPage.test.tsx
cd frontend && bunx playwright test e2e/inventory.spec.ts -g "filter"
```

E2E with zero local services: `docker compose -f docker-compose.e2e.yml run --rm playwright`.

Lint/typecheck: `cd backend && uv run ruff check app tests` · `cd frontend && bun run typecheck`.
No pre-commit hooks exist.

## Architecture

VM *documentation* inventory — no hypervisor is ever contacted. Every value is
user-entered or CSV-imported.

### Backend (`backend/app`)

`main.py` builds the app and mounts every router under `/api`. Layering:
`api/routes/*` (HTTP) → `services/*` (business logic) → `db/models.py` (SQLAlchemy).
Pydantic schemas live in `schemas/*`, separate from ORM models.

Two conventions do most of the work:

- **`api/deps.py` is the whole auth surface.** Typed `Annotated` aliases —
  `DbSession`, `ViewerUser`, `EditorUser`, `AdminUser`, `Csrf` — are the only
  things routes declare. RBAC is a numeric ladder (`ROLE_ORDER`: viewer 1 <
  editor 2 < admin 3) via `require_role`. Every state-changing route must take
  `Csrf`; omitting it silently disables CSRF for that endpoint.
- **`api/routes/_vm_subrouter.py::make_vm_subrouter`** generates the identical
  list/add/update/delete CRUD for disks, networks, and applications. Those three
  route files are ~10 lines each. Change the factory, not the three call sites.

Auth is cookie-session JWT (`core/security.py`): session token 12h, refresh 7d,
and the CSRF token is an **HMAC of the session token** keyed by `JWT_SECRET` —
not stored server-side, so it is derivable and stateless.

`health_score` is denormalized on the `Vm` row. Any mutation of a VM or its
children must call `services/vms.py::recompute_health(db, vm_id)` — the subrouter
factory already does this on add/delete. `services/vms.py::apply_vm_filters`
implements the operator-based filtering behind `GET /api/vms`.

Every VM field change writes an audit row with old/new values (`_write_audit`).

### Frontend (`frontend/src`)

Next.js App Router, but **pages under `src/app/` are deliberately thin shells**
that re-export a component from `src/routes/`:

```tsx
// src/app/(app)/inventory/page.tsx
export default function InventoryRoute() { return <InventoryPage />; }
```

Real UI lives in `src/routes/*.tsx`. Put logic there, not in `src/app/` —
`src/app/**` is excluded from Vitest coverage and is only covered by Playwright.

`src/api/client.ts` is the single HTTP layer: `credentials: 'include'`, reads the
`inventorymgr_csrf` cookie into an `X-CSRF-Token` header on every mutation, and
transparently retries once through `POST /api/auth/refresh` on 401. Never call
`fetch` directly from a component.

### Database

Alembic in `backend/alembic/`. Enums (`Platform`, `VmStatus`, `Environment`,
`Criticality`, `Lifecycle`, `OsFamily`, `VmType`) are Python `StrEnum`s in
`db/models.py` — changing one needs a migration. User-editable dropdown values are
a separate runtime concept served by `/api/settings/options`.

### Tests

- `backend/tests/conftest.py` hits a **real Postgres** (no SQLite), resets state
  between tests, and overrides `get_db`. Helpers: `create_user`, `login` (returns
  the CSRF token), `auth_headers(csrf)`, `vm_payload`, `create_vm_row`.
- Vitest enforces **80% coverage thresholds** on lines/statements/functions/branches.
- `playwright.config.ts` starts backend+frontend itself unless `BASE_URL` is set
  (Docker mode).

## Skills, MCP, and hooks

`.claude/settings.json` (committed) pins the plugins this repo relies on and adds a
`PostToolUse` hook that runs `graphify update` after any `.py`/`.ts`/`.tsx` edit, so
the graph never goes stale. No `.mcp.json` — the MCP servers below come from plugins,
and duplicating them would create a second source of truth.

### graphify (PostToolUse project hook + PreToolUse global guard)

A knowledge graph lives in `graphify-out/`. A global hook **blocks Read/Grep until
graphify has oriented you**:

```bash
graphify query "how does VM filtering work"   # scoped subgraph — start here
graphify explain "recompute_health"           # one concept + neighbors
graphify path "InventoryPage.tsx" "apply_vm_filters"
graphify update .                             # the PostToolUse hook does this for you
```

Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review. Rebuild with
`graphify . --code-only` (no LLM key needed; docs/images and community names are
skipped without one).

### Skills worth reaching for on this stack

| Task | Skill |
|------|-------|
| Backend review | `ecc:python-review`, `ecc:fastapi-review` |
| Frontend review | `ecc:react-review` (runs the typescript-reviewer agent alongside) |
| Alembic / schema work | `ecc:database-migrations`, `ecc:postgres-patterns` |
| Playwright work | `ecc:e2e-testing`, `ecc:browser-qa` |
| Before committing | `verify` (drives the real app), `ecc:code-review` |
| Library/API docs | `ecc:docs-lookup` (Context7 MCP) |

### MCP servers available

- **context7** — current docs for FastAPI, SQLAlchemy, Next.js, TanStack Query,
  Playwright. Prefer it over web search or memory for library APIs.
- **chrome-devtools** — drive the running frontend, read console/network. Use this
  instead of the ad-hoc `frontend/*.mjs` debug scripts.

## Conventions

- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Deliberate simplifications carry a `ponytail:` comment naming the ceiling.
- Accepted security tradeoffs go in `ACCEPTED_RISKS.md` with an automated check
  command; `tools/check-accepted-risks.sh` fails if a risk condition changes.
- `docs/RUNBOOK.md` is the deployment/ops reference (PM2). `docs/CONTRIBUTING.md`
  sections between the AUTO-GENERATED markers are derived from `justfile`,
  `devbox.json`, `pyproject.toml`, `package.json` — update the source, not the doc.
- `frontend/*.mjs`/`*.cjs` at the root (`eval-runner`, `check-console`, …) are
  one-off debugging scripts, not part of the build.
