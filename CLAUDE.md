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

just pm2-start  # also: pm2-stop/-restart/-kill/-logs/-status/-save/-startup (see docs/RUNBOOK.md)
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
so graph never stale. Most MCP servers come from those plugins; only playwright
is project-scoped in `.mcp.json`, which is gitignored — see below, a fresh clone
must recreate it.

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

### context-mode — default for large output

Plugin `context-mode@context-mode`. Keeps big command output **out of context**:
the command runs server-side, only your printed summary comes back.

Bash directly only for guaranteed-small ops: file mutations (`mkdir`/`mv`/`rm`),
git writes (`git add`/`commit`/`push`/`checkout`), navigation, `kill`, package
installs, `echo`. **Everything else goes through context-mode** — anything that
reads, queries, tests, builds, diffs, or inspects.

| Need | Tool |
|------|------|
| Run a command, get findings | `ctx_execute` |
| Analyse a file without loading it | `ctx_execute_file` (file lands in `FILE_CONTENT`) |
| Index a file, then query it | `ctx_index(path:)` then `ctx_search` |
| External docs | `ctx_fetch_and_index` then `ctx_search` |

Rules that actually bite:
- **Print your findings.** Only stdout enters context; no output = wasted call.
- Analyse in the sandbox, don't dump. Not `console.log(JSON.stringify(data))`.
- `ctx_index(path:)` — **never** `ctx_index(content:)`. `content` sends the data
  through context as a parameter, doubling the cost.
- Don't re-index what a previous tool call already returned.
- Editing a file? Use the normal Read/Edit tools. context-mode is for analysis.
- `ctx_search(queries: [...])` — batch every question into one call, BM25 is OR.

Applied here: `bun run test`, `uv run pytest`, `bunx playwright test`, `git log`,
and reading `frontend/reports/*` or any log all belong in `ctx_execute`.

### playwright MCP — interactive browser checks

Project-scoped in `.mcp.json` (gitignored, so absent on a fresh clone — if the
`browser_*` tools aren't in your tool list, that's why; recreate the file).
Complements `frontend/e2e/*.spec.ts`; it does not replace them — committed specs
stay the regression suite. Use the MCP to *drive* the running app when verifying
a change or chasing a UI bug.

**Always pass `filename`** on `browser_snapshot`, `browser_console_messages`, and
`browser_network_requests`. Without it a snapshot dumps 10K–135K tokens. Then read
it server-side:

```
browser_snapshot(filename: "/tmp/snap.md")
  → ctx_index(path: "/tmp/snap.md")  → ctx_search   # several questions
  → ctx_execute_file(path: "/tmp/snap.md")          # one-shot extraction
```

`browser_navigate` returns a snapshot automatically — ignore it, take an explicit
`browser_snapshot(filename:)` instead. The MCP drives a **single** browser, so it
is not parallel-safe; don't fan it out across subagents.

### Other MCP servers

- **context7** — current docs for FastAPI, SQLAlchemy, Next.js, TanStack Query,
  Playwright. Prefer over web search or memory for library APIs.
- **chrome-devtools** — drive running frontend, read console/network. Use
  instead of ad-hoc `frontend/*.mjs` debug scripts. ~15 of those scripts are
  still lying around unremoved; don't add more, don't treat them as the pattern.

## Conventions

- **Compact at 50% context.** Don't run a session to the wall — at 50% used,
  stop at the next task boundary and compact. Long plan executions in this repo
  (backend suite ~2 min per run, Playwright ~2.5 min) burn context faster than
  they look like they will, and a compaction forced mid-task loses the state
  needed to finish it. `/compact` is user-invoked; ask for it when you hit 50%.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Deliberate simplifications carry `ponytail:` comment naming ceiling.
- Accepted security tradeoffs go in `ACCEPTED_RISKS.md` with automated check
  command; `tools/check-accepted-risks.sh` fails if risk condition changes.
- `docs/RUNBOOK.md` = deployment/ops reference (PM2). `docs/CONTRIBUTING.md`
  sections between AUTO-GENERATED markers derived from `justfile`,
  `devbox.json`, `pyproject.toml`, `package.json` — update source, not doc.
- `frontend/*.mjs`/`*.cjs` at root (`eval-runner`, `check-console`, `quick-eval`,
  …) = one-off debugging scripts, not part of build. **Exceptions:**
  `next.config.mjs` and `postcss.config.mjs` are real build config — don't sweep
  them up when clearing the others out.