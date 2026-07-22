# CLAUDE.md

Guidance for Claude Code in this repo. Commands live in `justfile` (`just verify`
= full gate, run before any PR). All work inside `devbox shell`. No pre-commit hooks.

**Domain:** VM *documentation* inventory — the hypervisor is never contacted. Every
value is user-entered or CSV-imported.

## Backend gotchas (`backend/app`)

- **`api/deps.py` is the whole auth surface.** Routes declare only the typed
  aliases `DbSession`/`ViewerUser`/`EditorUser`/`AdminUser`/`Csrf`. RBAC is a
  numeric ladder (`ROLE_ORDER`). **Every state-changing route must take `Csrf`** —
  omit it and CSRF is silently off for that endpoint.
- CSRF token = HMAC of the session token keyed by `JWT_SECRET`, not stored
  server-side (stateless, derivable). Session JWT 12h, refresh 7d.
- **`health_score` is denormalized on the `Vm` row.** Any mutation of a VM or its
  children must call `services/vms.py::recompute_health(db, vm_id)`. The
  `_vm_subrouter.py::make_vm_subrouter` factory already does this on add/delete —
  change the factory, not the three thin call sites (disks/networks/applications).
- Every VM field change writes an audit row (`_write_audit`).

## Frontend gotchas (`frontend/src`)

- Pages under `src/app/` are **thin shells** re-exporting from `src/routes/*.tsx`.
  Put logic in `src/routes/` — `src/app/**` is excluded from Vitest coverage
  (Playwright-only).
- **All HTTP goes through `src/api/client.ts`** (`credentials:'include'`, injects
  `inventorymgr_csrf` → `X-CSRF-Token` on mutations, retries once via
  `/api/auth/refresh` on 401). Never call `fetch` from a component.
- Vitest enforces **80% coverage** on lines/statements/functions/branches.

## Database

- Enums (`Platform`, `VmStatus`, `Environment`, `Criticality`, `Lifecycle`,
  `OsFamily`, `VmType`, `StorageVendor`) are Python `StrEnum`s in `db/models.py`
  — changing one needs an Alembic migration. User-editable dropdown values are a
  **separate** runtime concept served by `/api/settings/options` (categories incl.
  `cluster`, seeded from existing VM clusters).
- `backend/tests/conftest.py` hits **real Postgres** (no SQLite), resets between
  tests. Helpers: `create_user`, `login` (returns CSRF), `auth_headers(csrf)`,
  `vm_payload`, `create_vm_row`.

## graphify (PreToolUse guard)

A global hook **blocks Read/Grep until graphify has oriented you**. Start with
`graphify query "<question>"` (scoped subgraph); also `graphify explain`,
`graphify path`. `graphify update .` runs automatically via PostToolUse after
`.py`/`.ts`/`.tsx` edits. `GRAPH_REPORT.md` only for broad architecture review.

## MCP notes

- **context-mode** — route large/unbounded output through `ctx_execute` /
  `ctx_execute_file` (tests, `git log`, log files, queries); only the printed
  summary enters context. Bash stays fine for small, guaranteed-short ops and
  file/git mutations. `ctx_index(path:)`, never `ctx_index(content:)`.
- **playwright MCP** — project-scoped in `.mcp.json`, which is **gitignored**, so
  absent on a fresh clone (recreate it if `browser_*` tools are missing). It
  *drives* the running app; committed `frontend/e2e/*.spec.ts` stay the regression
  suite. **Always pass `filename`** to `browser_snapshot`/`browser_console_messages`/
  `browser_network_requests` — without it a snapshot dumps 10K–135K tokens. Single
  browser, not parallel-safe.
- **context7** — prefer over memory/web for library API docs.

## Conventions

- **Compact at 50% context** — stop at the next task boundary and ask for
  `/compact`. Backend suite ~2 min, Playwright ~2.5 min per run burn context fast;
  a forced mid-task compaction loses state.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Deliberate simplifications carry a `ponytail:` comment naming the ceiling.
- Accepted security tradeoffs go in `ACCEPTED_RISKS.md` with an automated check;
  `tools/check-accepted-risks.sh` fails if the risk condition changes.
- `docs/CONTRIBUTING.md` sections between AUTO-GENERATED markers derive from
  `justfile`/`devbox.json`/`pyproject.toml`/`package.json` — edit source, not doc.
  `docs/RUNBOOK.md` = PM2 deployment/ops reference.
- Root `frontend/*.mjs`/`*.cjs` (`eval-runner`, `check-console`, …) are one-off
  debug scripts, not build. **Exceptions:** `next.config.mjs`, `postcss.config.mjs`
  are real build config.
<!-- codeburn:begin read-edit-ratio -->
Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.
<!-- codeburn:end read-edit-ratio -->
