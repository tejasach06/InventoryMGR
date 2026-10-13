set dotenv-load := true

setup:
	devbox run setup

db-up:
	podman compose -f docker-compose.e2e-db.yml up -d
	podman compose -f docker-compose.e2e-db.yml exec -T db-test pg_isready -U inventorymgr -d inventorymgr_test
	podman compose -f docker-compose.e2e-db.yml exec -T db-test psql -U inventorymgr -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'inventorymgr'" | grep -q 1 || podman compose -f docker-compose.e2e-db.yml exec -T db-test createdb -U inventorymgr inventorymgr

env:
	#!/usr/bin/env bash
	set -euo pipefail
	if [ -f .env ]; then
	    echo ".env exists, leaving it alone"
	else
	    umask 077
	    sed "s|^JWT_SECRET=.*|JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')|" .env.example > .env
	    echo "wrote .env with a generated JWT_SECRET"
	fi

build-prod:
	#!/usr/bin/env bash
	set -euo pipefail
	podman build -t localhost/inventorymgr-backend:latest ./backend-rust &
	back=$!
	podman build -t localhost/inventorymgr-frontend:latest --build-arg "INVENTORYMGR_API_URL=${INVENTORYMGR_API_URL:-http://inventorymgr-backend:8000}" ./frontend &
	front=$!
	wait $back
	wait $front

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
		printf 'postgresql://inventorymgr:%s@inventorymgr-db:5432/inventorymgr' "$postgres_password" | podman secret create inventorymgr-database-url - >/dev/null
		echo "created inventorymgr-postgres-password and inventorymgr-database-url"
	else
		echo "error: inventorymgr-postgres-password and inventorymgr-database-url must be created together" >&2
		echo "delete the stale InventoryMGR database secret and rerun: podman secret rm inventorymgr-postgres-password inventorymgr-database-url" >&2
		exit 1
	fi

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
	cd backend-rust && cargo build --locked
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub install
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub run --node build
	@echo "Starting backend in background and frontend..."
	(cd backend-rust && cargo run &)
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub run --node start
	@echo "frontend: http://127.0.0.1:3000  api: http://127.0.0.1:8000/api/health"

api-dev:
	cd backend-rust && cargo run

web-dev:
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub run --node dev

api-test:
	cd backend-rust && cargo test --locked

web-test:
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub run --node test

e2e:
	bash tools/run-rust-e2e.sh

verify:
	#!/usr/bin/env bash
	set -euo pipefail
	repo_root="$PWD"
	export CARGO_TARGET_DIR="$repo_root/backend-rust/target"
	cd backend-rust
	cargo build --locked
	cargo test --locked
	cd ../frontend
	PATH="$HOME/.nub/bin:$PATH" nub run --node lint
	PATH="$HOME/.nub/bin:$PATH" nub run --node typecheck
	PATH="$HOME/.nub/bin:$PATH" nub run --node test
	cd ..
	rust_binary="$CARGO_TARGET_DIR/debug/inventorymgr-backend"
	python_bin="$repo_root/backend/.venv/bin/python"
	test -x "$python_bin" || { echo "Run just setup to initialize the test-only Python oracle" >&2; exit 1; }
	evidence="${VERIFY_OUTPUT_DIR:-$repo_root/.audit/verification}"
	"$python_bin" tools/rust-parity/verify.py --rust-binary "$rust_binary" --output "$evidence/http" --scratch-dir "$evidence/scratch"
	"$python_bin" tools/rust-parity/migrations.py --rust-binary "$rust_binary" --output "$evidence/migrations"
	"$python_bin" tools/rust-parity/restore_concurrency.py --rust-binary "$rust_binary" --output "$evidence/restore-concurrency"
	bash tools/run-rust-e2e.sh

audit:
	@echo "=== Frontend (PATH="$HOME/.nub/bin:$PATH" nub audit) ==="
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub audit
	@echo "=== Backend (cargo audit) ==="
	cd backend-rust && cargo audit
	@echo "=== TypeScript typecheck ==="
	cd frontend && PATH="$HOME/.nub/bin:$PATH" nub run --node typecheck
	@echo "=== Accepted risks check ==="
	bash tools/check-accepted-risks.sh
