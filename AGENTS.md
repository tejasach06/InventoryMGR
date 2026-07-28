# Repository Guidelines

## Project Overview

InventoryMGR is a documentation-only infrastructure inventory for virtual machines, storage arrays, and physical hardware clusters. It serves as the single source of truth for sysadmins and IT ops staff. The hypervisor is never contacted; all data is user-entered or CSV-imported. The application prioritizes fast, auditable, and trustworthy record-keeping over enterprise chrome or multi-step wizards.

## Architecture & Data Flow

- **Backend Architecture**: Built with FastAPI (`backend/app/main.py`), SQLAlchemy 2.0 ORM (`app/db/models.py`), and Pydantic v2 schemas (`app/schemas/`). Business logic resides in `app/services/`.
- **Double-Submit Auth & Stateless CSRF**: Authentication uses an HTTP-only JWT session cookie (`inventorymgr_session`). CSRF tokens (`inventorymgr_csrf`) are derived statelessly via `HMAC-SHA256(jwt_secret, session_token)` and verified against incoming `X-CSRF-Token` headers — no server-side token storage.
- **RBAC Ladder**: Numeric role order (`viewer:1 < editor:2 < admin:3`) enforced in `app/api/deps.py` via typed aliases (`ViewerUser`, `EditorUser`, `AdminUser`, `Csrf`). Every state-changing route MUST declare the `Csrf` dependency.
- **Denormalized Health Score**: `Vm.health_score` (0–100) is stored on the VM row. Any VM or child record mutation triggers `services/vms.py::recompute_health(db, vm_id)`.
- **Audit Logging**: Every VM field modification creates an `AuditLog` row recording `field_name`, `old_value`, `new_value`, `user_id`, and timestamp.
- **Frontend Architecture**: Built with Next.js 15 App Router and React 18. Pages under `src/app/**/page.tsx` act as thin shells re-exporting client implementation components from `src/routes/*.tsx`.
- **HTTP & State Management**: All network requests pass through a single typed API client (`src/api/client.ts`) that handles CSRF header injection and single-shot 401 refresh retries. Server state is managed via TanStack Query; search, filter, sort, and pagination states are reflected in URL `searchParams`.

## Key Directories

- `backend/app/api/`: FastAPI route definitions (`routes/`) and auth dependency surface (`deps.py`).
- `backend/app/services/`: Service layer (`vms.py`, `vms_bulk.py`, `clusters.py`, `storage.py`, `csv_import.py`).
- `backend/app/db/`: Database models (`models.py`), session configuration (`session.py`), and Alembic migrations (`alembic/`).
- `backend/app/schemas/`: Pydantic request and response validation models (`vms.py`, `clusters.py`, `storage.py`).
- `backend/tests/`: Pytest suite and real Postgres test fixtures (`conftest.py`).
- `frontend/src/app/`: Next.js App Router thin shell pages (excluded from Vitest coverage).
- `frontend/src/routes/`: Main client-side route components (`InventoryPage.tsx`, `VmFormPage.tsx`, etc.).
- `frontend/src/components/`: Reusable UI components (`ui.tsx`, `Layout.tsx`, `InventoryToolbar.tsx`, `ColumnDrawer.tsx`, `BulkEditDrawer.tsx`, `filters/`).
- `frontend/src/api/`: Central API client (`client.ts`).
- `frontend/src/test/`: Vitest + React Testing Library component tests and helpers (`utils.tsx`, `setup.ts`).
- `frontend/e2e/`: Playwright E2E regression specs.

## Development Commands

Always run commands inside `devbox shell`. Use `just` recipes for primary tasks:

- **Full Quality Gate**: `just verify` (runs `ruff check`, `pytest`, `bun lint`, `bun typecheck`, `vitest`, `playwright`).
- **Security & Compliance Audit**: `just audit` (runs `bun audit`, `uv audit`, `typecheck`, `ruff`, `tools/check-accepted-risks.sh`).
- **Backend Commands**:
  - Dev API server: `just api-dev` (`uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`)
  - Run pytest suite: `just api-test` (`APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest`)
  - Linting: `cd backend && uv run ruff check app tests`
  - DB Migrations: `cd backend && uv run alembic upgrade head`
- **Frontend Commands**:
  - Dev web server: `just web-dev` (`bun run dev`)
  - Run unit tests: `just web-test` (`bun run test`)
  - Lint & typecheck: `cd frontend && bun run lint && bun run typecheck` (`tsc --noEmit`)
  - Run Playwright E2E: `just e2e` (`bunx playwright test`)
- **Database Helper**: `just db-up` (starts Docker Postgres container and creates `inventorymgr_test` DB).

## Code Conventions & Common Patterns

### Backend
- **Route Dependency Injection**: Routes declare dependencies via typed aliases:
  ```python
  @router.patch("/{vm_id}", response_model=VmRead)
  def update_vm(vm_id: uuid.UUID, payload: VmUpdate, db: DbSession, current_user: EditorUser, _: Csrf) -> VmRead:
  ```
  Unused security parameters take a `_`/`__` prefix to signal explicit dependency enforcement.
- **Service Layer Pattern**: Routes delegate database operations to service functions (`create_vm`, `update_vm`, `bulk_update_vms`) to ensure audit writing and health score recomputation.

### Frontend
- **Single HTTP Funnel**: Components MUST call methods on `api` from `src/api/client.ts`. Never use bare `fetch()`. Handle errors via `detailMessage(err)` and render using `Alert`.
- **The Instrument Panel Design System**:
  - **The Signal Rule**: Saturated colors are strictly reserved for semantic data categories (`status`, `criticality`, `environment`, `platform`, `os_family`, `lifecycle`). Chrome surfaces stay neutral.
  - **The Flat-By-Default Rule**: Resting components use hairline borders (`border-[var(--color-border)]`) and ambient shadows (`shadow-raised`). Overlay shadows (`shadow-overlay`) are reserved for transient drawers/dialogs.
  - **The Tabular Rule**: Scannable technical values (IPs, UUIDs, memory/CPU sizes, counts) MUST use the mono stack (`monoClass`) + `tabular-nums`.
  - **UI Class Constants**: Reuse pre-styled Tailwind class constants exported from `src/components/ui.tsx` (`primaryButtonClass`, `secondaryButtonClass`, `inputClass`, `selectClass`, `cardClass`, `tableClass`, etc.).
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
- `frontend/src/api/client.ts`: Typed API client with automatic CSRF injection and retry logic.
- `frontend/src/routes/InventoryPage.tsx`: Main inventory view with search, filter, server-side sorting, pagination, and bulk edit controls.
- `frontend/src/components/ui.tsx`: Core component library and shared Tailwind styling classes.
- `DESIGN.md` & `PRODUCT.md`: Design system rules, brand personality, and visual design tokens.

## Runtime/Tooling Preferences

- **Environment Manager**: Devbox (`devbox.json`). All commands should run inside `devbox shell`.
- **Backend Runtime**: Python >=3.12 managed via `uv`. Dependencies listed in `backend/pyproject.toml` and locked in `backend/uv.lock`.
- **Frontend Runtime**: Node.js 22 environment using **Bun** package manager (`bun run`, `bun install`, `bunx`).
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
