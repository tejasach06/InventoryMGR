# Repository Guidelines

## Project Overview

InventoryMGR is a documentation-only infrastructure inventory for virtual machines, storage arrays, and physical hardware clusters. It serves as the single source of truth for sysadmins and IT ops staff. The hypervisor is never contacted; all data is user-entered or CSV-imported. The application prioritizes fast, auditable, and trustworthy record-keeping over enterprise chrome or multi-step wizards.

- **Backend Architecture**: Built with FastAPI (`backend/app/main.py`), SQLAlchemy 2.0 ORM (`app/db/models.py`), and Pydantic v2 schemas (`app/schemas/`). Business logic resides in `app/services/`.
- **Double-Submit Auth & Stateless CSRF**: Authentication uses an HTTP-only JWT session cookie (`inventorymgr_session`). CSRF tokens (`inventorymgr_csrf`) are derived statelessly via `HMAC-SHA256(jwt_secret, session_token)` and verified against incoming `X-CSRF-Token` headers — no server-side token storage. Optional LDAP/Active Directory authentication (`services/ldap_auth.py`) is configured in Settings (admin-only) with group-DN-to-role mapping.
- **RBAC Ladder**: Numeric role order (`viewer:1 < editor:2 < admin:3`) enforced in `app/api/deps.py` via typed aliases (`ViewerUser`, `EditorUser`, `AdminUser`, `Csrf`). Every state-changing route MUST declare the `Csrf` dependency.
- **Denormalized Health Score**: `Vm.health_score` (0–100) is stored on the VM row. Any VM or child record mutation triggers `services/vms.py::recompute_health(db, vm_id)`.
- **Audit Logging**: Every VM field modification creates an `AuditLog` row recording `field_name`, `old_value`, `new_value`, `user_id`, and timestamp.
- **Per-User Preferences & Accent**: User preferences (including page column layout and accent color preset) are stored in `users.preferences` JSONB (`app/api/routes/preferences.py`).
- **Server-Side Fleet Aggregates**: `GET /api/dashboard` and `GET /api/reports/summary` compute exact fleet statistics in SQL directly without fetching capped client-side VM lists.
- **Frontend Architecture**: Built with Next.js 15 App Router and React 18. Pages under `src/app/**/page.tsx` act as thin shells re-exporting client implementation components from `src/routes/*.tsx`.
- **HTTP & State Management**: All network requests pass through typed API client modules (`src/api/core.ts`, `src/api/{auth,vms,clusters,storage,dashboard,imports,settings}.ts`) that handle CSRF header injection and single-shot 401 refresh retries. Server state is managed via TanStack Query; search, filter, sort, and pagination states are reflected in URL `searchParams`.
## Key Directories

- `backend/app/api/`: FastAPI route definitions (`routes/`) and auth dependency surface (`deps.py`).
- `backend/app/services/`: Service layer (`vms.py`, `vms_bulk.py`, `clusters.py`, `storage.py`, `csv_import.py`, `ldap_auth.py`).
- `backend/app/db/`: Database models (`models.py`), session configuration (`session.py`), and Alembic migrations (`alembic/`).
- `backend/app/schemas/`: Pydantic request and response validation models (`vms.py`, `clusters.py`, `storage.py`, `preferences.py`).
- `backend/tests/`: Pytest suite and real Postgres test fixtures (`conftest.py`).
- `frontend/src/app/`: Next.js App Router thin shell pages (excluded from Vitest coverage).
- `frontend/src/routes/`: Client-side route surfaces (`InventoryPage.tsx`, `VmDetailPage.tsx`, `VmFormPage.tsx`, `DashboardPage.tsx`, `ReportsPage.tsx`, `StoragePage.tsx`, `StorageDetailPage.tsx`, `ClustersPage.tsx`, `ClusterDetailPage.tsx`, `SettingsPage.tsx`, `UsersPage.tsx`, `ImportCsvPage.tsx`, `LdapSettingsPanel.tsx`, `LoginPage.tsx`).
- `frontend/src/components/`: Reusable UI components (`ui.tsx`, `Layout.tsx`, `InventoryToolbar.tsx`, `ColumnDrawer.tsx`, `BulkEditDrawer.tsx`, `AccentProvider.tsx`, `ThemeProvider.tsx`, `NotificationBell.tsx`, `SegmentedControl.tsx`, `FuzzyMultiSelect.tsx`, `PaginationFooter.tsx`, `filters/`).
- `frontend/src/api/`: Central API client core (`core.ts`) and domain-scoped modules (`auth.ts`, `vms.ts`, `clusters.ts`, `storage.ts`, `dashboard.ts`, `imports.ts`, `settings.ts`, `types.ts`).
- `frontend/src/test/`: Vitest + React Testing Library component tests and helpers (`utils.tsx`, `setup.ts`).
- `frontend/e2e/`: Playwright E2E regression specs.

## Development Commands

Always run commands inside `devbox shell`. Use `just` recipes for primary tasks:

- **Full Quality Gate**: `just verify` (runs `ruff check`, `pytest`, `nub lint`, `nub typecheck`, `vitest`, `playwright`).
- **Security & Compliance Audit**: `just audit` (runs `nub audit`, `uv audit`, `typecheck`, `ruff`, `tools/check-accepted-risks.sh`).
- **Backend Commands**:
  - Dev API server: `just api-dev` (`uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`)
  - Run pytest suite: `just api-test` (`APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest`)
  - Linting: `cd backend && uv run ruff check app tests`
  - DB Migrations: `cd backend && uv run alembic upgrade head`
- **Frontend Commands**:
  - Dev web server: `just web-dev` (`nub run dev`)
  - Run unit tests: `just web-test` (`nub run test`)
  - Lint & typecheck: `cd frontend && nub run lint && nub run typecheck` (`tsc --noEmit`)
  - Run Playwright E2E: `just e2e` (`nubx playwright test`)
- **Database Helper**: `just db-up` (starts Docker Postgres container and creates `inventorymgr_test` DB).
- **Deployment Commands**: `just up` (podman compose container stack), `just up-local` (PM2 process manager stack). See `docs/RUNBOOK.md` for full operations guide.

## Code Conventions & Common Patterns

### Backend
- **Route Dependency Injection**: Routes declare dependencies via typed aliases:
  ```python
  @router.patch("/{vm_id}", response_model=VmRead)
  def update_vm(vm_id: uuid.UUID, payload: VmUpdate, db: DbSession, current_user: EditorUser, _: Csrf) -> VmRead:
  ```
  Unused security parameters take a `_`/`__` prefix to signal explicit dependency enforcement.
- **Service Layer Pattern**: Routes delegate database operations to service functions (`create_vm`, `update_vm`, `bulk_update_vms`) to ensure audit writing and health score recomputation. Shared child-collection CRUD subrouters use `app/api/routes/_child_crud.py::make_child_router`.

### Frontend
- **Single HTTP Funnel**: Components MUST call domain API modules from `src/api/` (backed by `src/api/core.ts`). Never use bare `fetch()`. Handle errors via `detailMessage(err)` and render using `Alert`.
- **The Instrument Panel Design System**:
  - **The Signal Rule**: Saturated colors are strictly reserved for semantic data categories (`status`, `criticality`, `environment`, `platform`, `os_family`, `vm_type`). Chrome surfaces stay neutral.
  - **The Flat-By-Default Rule**: Resting components use hairline borders (`border-[var(--color-border)]`) and ambient shadows (`shadow-raised`). Overlay shadows (`shadow-overlay`) are reserved for transient drawers/dialogs.
  - **The Tabular Rule**: Scannable technical values (IPs, UUIDs, memory/CPU sizes, counts) MUST use the mono stack (`monoClass`) + `tabular-nums`.
  - **UI Class Constants**: Reuse pre-styled Tailwind class constants exported from `src/components/ui.tsx` (`primaryButtonClass`, `secondaryButtonClass`, `dangerButtonClass`, `inputClass`, `selectClass`, `textareaClass`, `authInputClass`, `cardClass`, `tableWrapClass`, `filterBarClass`, `statTileClass`, `labelClass`, `helpTextClass`, `sectionTitleClass`, `eyebrowClass`, `tableClass`, `tableHeadClass`, `tableBodyClass`, `tableRowClass`, `tableCellClass`, `monoClass`).
- **URL-Driven List & Filter State**: Search query, filters, page number, page size, sort key, and direction are synchronized with URL `searchParams`.

### CSV Import & Export Round-Trip
- Import (`csv_import.py`) and export (`export_vms`) share identical cell schemas for child collections to guarantee lossless export → import round-trips:
  - Disks: `name:size[:storage_name[:storage_type]]` (separated by `;`)
  - Role-scoped IPs: `address[:vlan[:gateway]]` (separated by `;`)
  - Applications: `name[:owner]` (separated by `;`)

## Important Files

- `backend/app/api/deps.py`: Complete auth, CSRF, and RBAC dependency surface.
- `backend/app/db/models.py`: Single SQLAlchemy models file and `compute_health_score` function.
- `backend/app/services/vms.py`: Core VM service handling CRUD, audit logging, health score recomputation, and filter/sort logic.
- `backend/app/services/csv_import.py`: CSV parsing, normalization, preview diffing, and additive child record attachment.
- `frontend/src/api/core.ts`: Typed API client core with automatic CSRF injection and retry logic.
- `frontend/src/routes/InventoryPage.tsx`: Main inventory view with search, filter, server-side sorting, pagination, and bulk edit controls.
- `frontend/src/components/ui.tsx`: Core component library and shared Tailwind styling classes.
- `DESIGN.md` & `PRODUCT.md`: Design system rules, brand personality, and visual design tokens.

## Runtime/Tooling Preferences

- **Environment Manager**: Devbox (`devbox.json`). All commands should run inside `devbox shell`.
- **Branching Model**: Active development takes place on `dev`. The `main` branch is deploy-only and uses an expanded `.gitignore` to exclude dev assets; deployments run `deploy.sh` (`git pull origin main && git clean -fdX`).
- **Backend Runtime**: Python >=3.12 managed via `uv`. Dependencies listed in `backend/pyproject.toml` and locked in `backend/uv.lock`.
- **Frontend Runtime**: Node.js 22 environment using **Nub** package manager (`nub run`, `nub install`, `nubx`).
- **Container Topology**: Postgres 16 running on `127.0.0.1:54329` for local testing (`docker-compose.e2e-db.yml`).
- **Security Registers**: Accepted risks documented in `ACCEPTED_RISKS.md` and checked by `tools/check-accepted-risks.sh`.

## Testing & QA

- **Backend (Pytest)**:
  - Configuration in `backend/pyproject.toml`.
  - Runs against real Postgres test DB on `127.0.0.1:54329` (`inventorymgr_test`).
  - Automatic DB schema reset before/after each test via `reset_database` fixture in `conftest.py`.
  - Helpers: `create_user`, `login`, `auth_headers(csrf)`, `vm_payload`, `create_vm_row`.
- **Frontend Unit & Component (Vitest)**:
  - Configuration in `frontend/vitest.config.ts` (`jsdom` environment).
  - Enforces **80% coverage floor** on lines, statements, functions, and branches (`src/app/**` excluded).
  - API methods mocked via `vi.spyOn(api, ...)` or `vi.mock('next/navigation')`.
  - Test helper: `renderWithProviders` in `src/test/utils.tsx`.
- **End-to-End (Playwright)**:
  - Specs located in `frontend/e2e/*.spec.ts`.
  - Configuration in `frontend/playwright.config.ts`.
  - In host mode, `webServer` automatically resets test DB schemas, executes Alembic migrations, and launches FastAPI (`:8000`) & Next.js (`:3000`) dev servers.

## Agent Tooling & Workflow

- **Codebase discovery — `graphify` first**: use `graphify query "<question>"`, `graphify path "<A>" "<B>"`, and `graphify explain "<concept>"` before text-based grep/glob when finding files, mapping architecture, or tracing connections between modules. Run `graphify update .` at the end of every task/phase after code modifications.
- **Large output processing — `context-mode`**: route large/unbounded command output (pytest suites, nub test logs, git logs/diffs, build output, container logs, large data files) through `ctx_execute`, `ctx_execute_file`, `ctx_search`, `ctx_index`, or `ctx_batch_execute` instead of reading raw. For indexing, use `ctx_index(path:)`, never `ctx_index(content:)`.
- **Cross-session memory — `mempalace`**: `mempalace search "<query>"` before answering questions about past decisions; `mempalace mine .` to add new project/session context to the `inventorymgr` wing.
- **Skills, by trigger**:
  - `impeccable` — UI/UX work touching `src/routes/`, `src/components/ui.tsx`, or DESIGN.md rules.
  - `brainstorming` — before adding/modifying inventory fields, import/export cell schemas, or RBAC rules; clarify intent before touching `services/` or `schemas/`.
  - `systematic-debugging` — bugs in health score, CSRF, audit logging, or CSV round-trip; these are cross-cutting (mutation → audit → health recompute) and a shallow fix breaks the invariant elsewhere.
  - `test-driven-development` — any feature or bugfix: write the failing pytest/vitest case against the contract (RBAC boundary, health score formula, CSV round-trip) before implementation code.
  - `verification-before-completion` — before claiming a fix/feature works: run `just api-test` / `just web-test` (or the scoped subset) and confirm actual output.
  - `writing-plans` + `executing-plans` — changes spanning both `backend/app/services/` and `frontend/src/routes/` (e.g. a new VM field needs schema, service, route, and form updates).
- **MCP servers**:
  - `context7` (`query-docs`, `resolve-library-id`) — FastAPI, SQLAlchemy 2.0, Pydantic v2, Next.js 15 App Router, TanStack Query, or Alembic API/config questions; these libraries move fast enough that training data may be stale.
  - `postgres` (`query`) — read-only inspection of the local Postgres test DB (`127.0.0.1:54329`, `inventorymgr_test`) to verify schema state, audit log rows, or health score values during debugging. Never a substitute for the Alembic migration path.