set dotenv-load := true

setup:
	devbox run setup

db-up:
	docker compose -f docker-compose.e2e-db.yml up -d
	docker compose -f docker-compose.e2e-db.yml exec -T db-test pg_isready -U inventorymgr -d inventorymgr_test
	docker compose -f docker-compose.e2e-db.yml exec -T db-test psql -U inventorymgr -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='inventorymgr'" | grep -q 1 || docker compose -f docker-compose.e2e-db.yml exec -T db-test createdb -U inventorymgr inventorymgr

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
