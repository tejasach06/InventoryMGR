# Dependency-upgrade verification runs inside Devbox: `devbox run -- just verify`.
set dotenv-load := true

setup:
	devbox run setup

db-up:
	podman compose -f docker-compose.e2e-db.yml up -d
	podman compose -f docker-compose.e2e-db.yml exec -T db-test pg_isready -U inventorymgr -d inventorymgr_test
	podman compose -f docker-compose.e2e-db.yml exec -T db-test psql -U inventorymgr -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='inventorymgr'" | grep -q 1 || podman compose -f docker-compose.e2e-db.yml exec -T db-test createdb -U inventorymgr inventorymgr

env:
	@test -f .env && echo ".env exists — leaving it alone" && exit 0 || true
	@sed "s|^JWT_SECRET=.*|JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')|" .env.example > .env
	@echo "wrote .env with a generated JWT_SECRET"

build-prod:
	podman build -t localhost/inventorymgr-backend:latest ./backend
	podman build -t localhost/inventorymgr-frontend:latest --build-arg "INVENTORYMGR_API_URL=${INVENTORYMGR_API_URL:-http://inventorymgr-backend:8000}" ./frontend

quadlet-secrets:
	#!/usr/bin/env bash
	set -euo pipefail
	secret_exists() { podman secret exists "$1" >/dev/null 2>&1; }
	if secret_exists inventorymgr-jwt-secret; then
		echo "inventorymgr-jwt-secret exists — leaving it alone"
	else
		python3 -c 'import secrets; print(secrets.token_hex(32))' | podman secret create inventorymgr-jwt-secret - >/dev/null
		echo "created inventorymgr-jwt-secret"
	fi
	pg_exists=0
	dburl_exists=0
	secret_exists inventorymgr-postgres-password && pg_exists=1 || true
	secret_exists inventorymgr-database-url && dburl_exists=1 || true
	if [ "$pg_exists" -eq 1 ] && [ "$dburl_exists" -eq 1 ]; then
		echo "database secrets exist — leaving them alone"
	elif [ "$pg_exists" -eq 0 ] && [ "$dburl_exists" -eq 0 ]; then
		postgres_password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
		printf '%s' "$postgres_password" | podman secret create inventorymgr-postgres-password - >/dev/null
		printf 'postgresql+psycopg://inventorymgr:%s@inventorymgr-db:5432/inventorymgr' "$postgres_password" | podman secret create inventorymgr-database-url - >/dev/null
		echo "created inventorymgr-postgres-password and inventorymgr-database-url"
	else
		echo "error: inventorymgr-postgres-password and inventorymgr-database-url must be created together" >&2
		echo "delete the stale InventoryMGR database secret and rerun: podman secret rm inventorymgr-postgres-password inventorymgr-database-url" >&2
		exit 1
	fi
omp-refactor module:
	bash tools/omp-refactor.sh {{module}}

up: env
	podman compose up -d --build
	@echo "frontend: http://127.0.0.1:${FRONTEND_PORT:-3000}  api: http://127.0.0.1:${BACKEND_PORT:-8000}/api/health"

down:
	podman compose down

logs:
	podman compose logs -f

ps:
	podman compose ps

up-local: env db-up
	cd backend && uv sync
	cd backend && uv run alembic upgrade head
	cd frontend && bun install
	cd frontend && bun run build
	pm2 start ecosystem.config.js
	@echo "frontend: http://127.0.0.1:3000  api: http://127.0.0.1:8000/api/health"
api-dev:
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

web-dev:
	cd frontend && bun run dev

api-test:
	cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest

web-test:
	cd frontend && bun run test

e2e:
	cd frontend && bunx playwright test

verify:
	cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest
	cd frontend && bun run lint && bun run typecheck && bun run test
	cd frontend && bunx playwright test

audit:
	@echo "=== Frontend (bun audit) ==="
	cd frontend && bun audit
	@echo "=== Backend (uv audit) ==="
	cd backend && uv audit
	@echo "=== TypeScript typecheck ==="
	cd frontend && bun run typecheck
	@echo "=== Python lint (ruff) ==="
	cd backend && uv run ruff check app tests
	@echo "=== Accepted risks check ==="
	bash tools/check-accepted-risks.sh

pm2-start:
	pm2 start ecosystem.config.js

pm2-stop:
	pm2 stop all

pm2-restart:
	pm2 restart all

pm2-kill:
	pm2 kill

pm2-logs:
	pm2 logs

pm2-status:
	pm2 status

pm2-save:
	pm2 save

pm2-startup:
	pm2 startup
