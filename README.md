# InventoryMGR

InventoryMGR is a small full-stack inventory manager for virtual machines. It provides a FastAPI backend, a Next.js/Tailwind frontend, PostgreSQL persistence, cookie-based login, role-based access control, VM inventory CRUD, user administration, and CSV preview/commit imports.

## Stack

- Backend: Python 3.12+, FastAPI, SQLAlchemy, Alembic, PostgreSQL, PyJWT
- Frontend: Next.js, React, TypeScript, Tailwind CSS, TanStack Query
- Tooling: devbox, uv, bun, just, pytest, Vitest, Playwright

## Main features

- First-deployment admin account creation from the login page.
- Session-cookie authentication with CSRF protection for state-changing requests.
- Roles: `admin`, `editor`, and `viewer`.
- VM inventory list/detail/create/edit/delete.
- CSV import preview and commit flow.
- Admin-only user management.

## Project layout

```text
backend/   FastAPI app, database models, Alembic migrations, pytest tests
frontend/  React app, API client, UI routes, unit and E2E tests
justfile   Common local commands
devbox.json Development runtime and PostgreSQL scripts
```

## Configuration

Copy the example environment file and edit secrets before running outside local development:

```bash
cp .env.example .env
```

Important variables:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development`, `test`, or `production` |
| `DATABASE_URL` | PostgreSQL URL used by the backend |
| `TEST_DATABASE_URL` | PostgreSQL URL used by backend tests |
| `JWT_SECRET` | Secret used to sign session tokens |
| `APP_CORS_ORIGINS` | Comma-separated frontend origins allowed by the API |

For production, set a strong `JWT_SECRET`. The first admin account is created from the `/login` setup page when the users table is empty.

## Run locally

The easiest local path is devbox:

```bash
devbox run setup
just api-dev
just web-dev
```

Open the app at:

```text
http://127.0.0.1:3000
```

On a fresh database, `/login` shows `Create admin account`. Create the first admin there; later visits show the normal sign-in form.

If setup has already run, start only the database and apps:

```bash
just db-up
just api-dev
just web-dev
```

## Tests

```bash
just api-test
just web-test
just e2e
```

Full verification:

```bash
just verify
```

## Simple deployment

This repository does not include Docker or platform-specific deployment files. A straightforward deployment uses PostgreSQL, one backend process, one Next.js frontend process, and a reverse proxy.

### 1. Provision PostgreSQL

Create a production database and user, then set `DATABASE_URL`, for example:

```text
postgresql+psycopg://inventorymgr:<password>@<host>:5432/inventorymgr
```

### 2. Configure production environment

Create `.env` on the server:

```bash
APP_ENV=production
DATABASE_URL=postgresql+psycopg://inventorymgr:<password>@<host>:5432/inventorymgr
JWT_SECRET=<long-random-secret>
SESSION_COOKIE_NAME=inventorymgr_session
CSRF_COOKIE_NAME=inventorymgr_csrf
APP_CORS_ORIGINS=https://your-domain.example
```

### 3. Install backend dependencies and migrate

```bash
cd backend
uv sync
uv run alembic upgrade head
```

### 4. Start the backend

```bash
cd backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Run this under a process manager such as systemd, Supervisor, or your hosting platform's service runner.

### 5. Build and serve the frontend

```bash
cd frontend
bun install
INVENTORYMGR_API_URL=http://127.0.0.1:8000 bun run build
INVENTORYMGR_API_URL=http://127.0.0.1:8000 bun run start
```

Run this under a process manager such as systemd, Supervisor, or your hosting platform's service runner.

### 6. Reverse proxy rules

Route browser traffic like this:

- `/api/*` -> backend at `http://127.0.0.1:8000`
- everything else -> Next frontend at `http://127.0.0.1:3000`

The frontend uses `/api` as its API prefix, so browser traffic remains same-origin in production.

### 7. First login

Open `/login` after the backend and frontend are running. If no users exist, the page shows `Create admin account`; create the first admin there. After that, `/login` shows the normal sign-in form.

## Useful commands

```bash
just setup      # install dependencies, initialize DB, run migrations
just db-up      # start PostgreSQL and create local DBs
just api-dev    # run FastAPI with reload on 127.0.0.1:8000
just web-dev    # run Next.js on 127.0.0.1:3000
just verify     # backend lint/tests + frontend typecheck/tests + Playwright
```
