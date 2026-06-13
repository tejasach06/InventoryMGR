set dotenv-load := true

setup:
	devbox run setup

db-up:
	devbox run db:start && devbox run db:create

api-dev:
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

web-dev:
	cd frontend && bun run dev --host 127.0.0.1 --port 5173

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
