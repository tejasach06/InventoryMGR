# Contributing to InventoryMGR

<!-- AUTO-GENERATED: prerequisites, scripts, and env table are generated from devbox.json, justfile, pyproject.toml, package.json -->

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Devbox](https://www.jetify.com/devbox) | any | Reproducible dev environment |
| Python | 3.12+ | Backend runtime (managed by Devbox) |
| Node.js | 22 | Frontend runtime (managed by Devbox) |
| Bun | latest | Frontend package manager (managed by Devbox) |
| PostgreSQL | 16 | Database (Docker: `docker compose -f docker-compose.e2e-db.yml up -d`) |
| `just` | any | Task runner (managed by Devbox) |

## Setup

```bash
# Enter the Devbox shell (installs all tools automatically)
devbox shell

# One-shot: install deps, init DB, run migrations
just setup
```

`just setup` runs in order: `uv sync`, `bun install`, `alembic upgrade head`. (PostgreSQL via `docker compose -f docker-compose.e2e-db.yml up -d` required first.)

## Available Commands

<!-- AUTO-GENERATED from justfile -->

| Command | Description |
|---------|-------------|
| `just setup` | Install all dependencies, run migrations (requires Docker PG running) |
| `just db-up` | Start Docker PostgreSQL for E2E/tests |
| `just api-dev` | FastAPI dev server on `127.0.0.1:8000` with reload |
| `just web-dev` | Next.js dev server on `:3000` |
| `just api-test` | Run backend pytest suite against the test database |
| `just web-test` | Run frontend Vitest unit tests |
| `just e2e` | Run Playwright end-to-end tests (requires Docker PG running) |
| `just verify` | Full check: ruff + pytest + tsc + vitest + Playwright |
| `just audit` | bun audit + uv audit + typecheck + ruff + accepted-risk check |
| `just pm2-start` | Start backend + frontend via PM2 (production) |
| `just pm2-stop` | Stop all PM2 processes |
| `just pm2-restart` | Restart all PM2 processes |
| `just pm2-logs` | Tail PM2 logs |
| `just pm2-status` | Show PM2 process table |
| `just pm2-save` | Persist PM2 process list |
| `just pm2-startup` | Generate OS init script for PM2 |
| `just pm2-kill` | Kill the PM2 daemon |

## Frontend Scripts

<!-- AUTO-GENERATED from frontend/package.json -->

| Command | Description |
|---------|-------------|
| `bun run dev` | Next.js dev server on `127.0.0.1:3000` |
| `bun run build` | Production build with type checking |
| `bun run start` | Production server on `0.0.0.0:3000` |
| `bun run test` | Vitest unit test suite |
| `bun run lint` | TypeScript type check (no-emit) |
| `bun run typecheck` | TypeScript type check (no-emit) |
| `bun run e2e` | Playwright E2E tests |

## Testing

### Backend

```bash
# Unit / integration tests (uses TEST_DATABASE_URL)
just api-test

# With ruff lint check
cd backend && uv run ruff check app tests
```

### Frontend

```bash
# Unit tests (Vitest)
just web-test

# Type check
cd frontend && bun run typecheck

# E2E (requires running backend + frontend)
just e2e
```

### E2E in Docker (no local services needed)

```bash
docker compose -f docker-compose.e2e.yml run --rm playwright
```

## Code Style

| Layer | Tool | Config |
|-------|------|--------|
| Backend | ruff | `pyproject.toml` — line length 100, rules E/F/I/UP/B |
| Frontend | TypeScript strict | `tsconfig.json` |

No pre-commit hooks are configured — run `just verify` before submitting a PR.

## Pull Requests

- Create a feature branch from `main`.
- Keep changes focused and describe the intent clearly in the PR summary.
- Include testing details and any relevant screenshots or notes.
- Run `just verify` before requesting review.

## Environment Variables

See [`.env.example`](../.env.example) at the repo root for a full reference. Copy it to `.env` before first run:

```bash
cp .env.example .env
```

<!-- END AUTO-GENERATED -->
