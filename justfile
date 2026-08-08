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
