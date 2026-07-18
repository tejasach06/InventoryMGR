# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Commands

All work inside `devbox shell`. Task runner `just` (see `justfile`).

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

E2E, zero local services: `docker compose -f docker-compose.e2e.yml run --rm playwright`.

Lint/typecheck: `cd backend && uv run ruff check app tests` · `cd frontend && bun run typecheck`.
No pre-commit hooks.

## Architecture

VM *documentation* inventory — hypervisor never contacted. Every value user-entered or CSV-imported.

### Backend (`backend/app`)

`main.py` builds app, mounts every router under `/api`. Layering:
`api/routes/*` (HTTP) → `services/*` (business logic) → `db/models.py` (SQLAlchemy).
Pydantic schemas in `schemas/*`, separate from ORM models.

Two conventions do most work:

- **`api/deps.py` is whole auth surface.** Typed `Annotated` aliases —
  `DbSession`, `ViewerUser`, `EditorUser`, `AdminUser`, `Csrf` — only things
  routes declare. RBAC = numeric ladder (`ROLE_ORDER`: viewer 1 < editor 2 <
  admin 3) via `require_role`. Every state-changing route must take `Csrf`;
  omit it and CSRF silently off for that endpoint.
- **`api/routes/_vm_subrouter.py::make_vm_subrouter`** generates identical
  list/add/update/delete CRUD for disks, networks, applications. Those three
  route files ~10 lines each. Change factory, not three call sites.

Auth = cookie-session JWT (`core/security.py`): session token 12h, refresh 7d.
CSRF token is **HMAC of session token** keyed by `JWT_SECRET` — not stored
server-side, so derivable and stateless.

`health_score` denormalized on `Vm` row. Any mutation of VM or children must
call `services/vms.py::recompute_health(db, vm_id)` — subrouter factory already
does this on add/delete. `services/vms.py::apply_vm_filters` implements
operator-based filtering behind `GET /api/vms`.

Every VM field change writes audit row with old/new values (`_write_audit`).

### Frontend (`frontend/src`)

Next.js App Router, but **pages under `src/app/` deliberately thin shells**
re-exporting component from `src/routes/`:

```tsx
// src/app/(app)/inventory/page.tsx
export default function InventoryRoute() { return <InventoryPage />; }
```

Real UI in `src/routes/*.tsx`. Put logic there, not `src/app/` —
`src/app/**` excluded from Vitest coverage, only covered by Playwright.

`src/api/client.ts` = single HTTP layer: `credentials: 'include'`, reads
`inventorymgr_csrf` cookie into `X-CSRF-Token` header on every mutation,
retries once through `POST /api/auth/refresh` on 401. Never call `fetch`
directly from component.

### Database

Alembic in `backend/alembic/`. Enums (`Platform`, `VmStatus`, `Environment`,
`Criticality`, `Lifecycle`, `OsFamily`, `VmType`) = Python `StrEnum`s in
`db/models.py` — changing one needs migration. User-editable dropdown values
separate runtime concept, served by `/api/settings/options`.

### Tests

- `backend/tests/conftest.py` hits **real Postgres** (no SQLite), resets state
  between tests, overrides `get_db`. Helpers: `create_user`, `login` (returns
  CSRF token), `auth_headers(csrf)`, `vm_payload`, `create_vm_row`.
- Vitest enforces **80% coverage thresholds** on lines/statements/functions/branches.
- `playwright.config.ts` starts backend+frontend itself unless `BASE_URL` set
  (Docker mode).

## Skills, MCP, and hooks

`.claude/settings.json` (committed) pins plugins this repo relies on, adds
`PostToolUse` hook running `graphify update` after any `.py`/`.ts`/`.tsx` edit,
so graph never stale. No `.mcp.json` — MCP servers below come from plugins;
duplicating them would create second source of truth.

### graphify (PostToolUse project hook + PreToolUse global guard)

Knowledge graph in `graphify-out/`. Global hook **blocks Read/Grep until
graphify oriented you**:

```bash
graphify query "how does VM filtering work"   # scoped subgraph — start here
graphify explain "recompute_health"           # one concept + neighbors
graphify path "InventoryPage.tsx" "apply_vm_filters"
graphify update .                             # the PostToolUse hook does this for you
```

Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review. Rebuild
with `graphify . --code-only` (no LLM key needed; docs/images and community
names skipped without one).

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
  Playwright. Prefer over web search or memory for library APIs.
- **chrome-devtools** — drive running frontend, read console/network. Use
  instead of ad-hoc `frontend/*.mjs` debug scripts.

## Conventions

- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Deliberate simplifications carry `ponytail:` comment naming ceiling.
- Accepted security tradeoffs go in `ACCEPTED_RISKS.md` with automated check
  command; `tools/check-accepted-risks.sh` fails if risk condition changes.
- `docs/RUNBOOK.md` = deployment/ops reference (PM2). `docs/CONTRIBUTING.md`
  sections between AUTO-GENERATED markers derived from `justfile`,
  `devbox.json`, `pyproject.toml`, `package.json` — update source, not doc.
- `frontend/*.mjs`/`*.cjs` at root (`eval-runner`, `check-console`, …) =
  one-off debugging scripts, not part of build.