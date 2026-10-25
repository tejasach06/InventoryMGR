set dotenv-load := true
export PATH := env("HOME") + "/.cargo/bin:" + env("HOME") + "/.local/bin:" + env("PATH")

setup:
	#!/usr/bin/env bash
	set -euo pipefail
	for tool in rustc cargo cc uv node pnpm podman; do
	    command -v "$tool" >/dev/null || { echo "Install $tool before running just setup (see README.md)" >&2; exit 1; }
	done
	(cd frontend && pnpm install --frozen-lockfile --strict-peer-dependencies)
	(cd frontend && pnpm exec playwright install chromium --no-shell)
	(cd backend && uv sync --frozen --extra dev)
	(cd backend-rust && cargo build --locked)

db-up:
	#!/usr/bin/env bash
	set -euo pipefail
	podman compose -f docker-compose.e2e-db.yml up -d
	for attempt in {1..60}; do
	    if podman compose -f docker-compose.e2e-db.yml exec -T db-test pg_isready -U inventorymgr -d inventorymgr_test >/dev/null 2>&1; then break; fi
	    if [ "$attempt" -eq 60 ]; then echo "Development PostgreSQL readiness timed out" >&2; exit 1; fi
	    sleep 1
	done
	if ! podman compose -f docker-compose.e2e-db.yml exec -T db-test psql -U inventorymgr -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'inventorymgr'" | grep -q 1; then
	    podman compose -f docker-compose.e2e-db.yml exec -T db-test createdb -U inventorymgr inventorymgr
	fi

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
	podman build -t localhost/inventorymgr-backend:latest ./backend-rust
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

native-prereqs:
	#!/usr/bin/env bash
	set -euo pipefail
	for tool in pg_dump pg_restore; do
	    command -v "$tool" >/dev/null || { echo "Install PostgreSQL 17 clients for native backups, or use just up" >&2; exit 1; }
	    "$tool" --version | grep -Eq ' \(PostgreSQL\) 17\.' || { echo "$tool must be PostgreSQL 17" >&2; exit 1; }
	done

up-local: native-prereqs env db-up
	#!/usr/bin/env bash
	set -euo pipefail
	(cd backend-rust && cargo build --locked)
	(cd frontend && pnpm install --frozen-lockfile --strict-peer-dependencies && pnpm run build)
	export BACKUP_DIR="$(realpath -m "${BACKUP_DIR:-backups}")"
	backend_pid=""
	cleanup() { if [ -n "$backend_pid" ]; then kill "$backend_pid" 2>/dev/null || true; wait "$backend_pid" 2>/dev/null || true; fi; }
	trap cleanup EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	(cd backend-rust && exec ./target/debug/inventorymgr-backend) &
	backend_pid=$!
	echo "frontend: http://127.0.0.1:3000  api: http://127.0.0.1:8000/api/health"
	(cd frontend && pnpm run start)

api-dev:
	cd backend-rust && cargo run --locked

web-dev:
	cd frontend && pnpm run dev

api-test:
	cd backend-rust && cargo test --locked

web-test:
	cd frontend && pnpm run test

e2e:
	bash tools/run-rust-e2e.sh

verify:
	#!/usr/bin/env bash
	set -euo pipefail
	repo_root="$PWD"
	export CARGO_TARGET_DIR="$repo_root/backend-rust/target"
	cd backend-rust
	cargo build --locked
	cargo test --locked -- --include-ignored --test-threads=1
	cd ../frontend
	pnpm run lint
	pnpm run test
	cd ..
	rust_binary="$CARGO_TARGET_DIR/debug/inventorymgr-backend"
	python_bin="$repo_root/backend/.venv/bin/python"
	test -x "$python_bin" || { echo "Run just setup to initialize the test-only Python oracle" >&2; exit 1; }
	evidence="${VERIFY_OUTPUT_DIR:-$repo_root/.audit/verification-$(date -u +%Y%m%dT%H%M%SZ)}"
	test ! -e "$evidence" || { echo "Verification output already exists: $evidence" >&2; exit 1; }
	mkdir -p "$evidence"
	"$python_bin" tools/rust-parity/verify.py --rust-binary "$rust_binary" --output "$evidence/http" --scratch-dir "$evidence/scratch"
	"$python_bin" tools/rust-parity/migrations.py --rust-binary "$rust_binary" --output "$evidence/migrations"
	"$python_bin" tools/rust-parity/restore_concurrency.py --rust-binary "$rust_binary" --output "$evidence/restore-concurrency"
	bash tools/run-rust-e2e.sh
	printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$evidence/SUCCESS"

audit:
	#!/usr/bin/env bash
	set -euo pipefail
	echo "=== Frontend (pnpm audit) ==="
	(cd frontend && pnpm audit)
	echo "=== Backend (cargo audit) ==="
	(cd backend-rust && cargo audit)
	echo "=== Python oracle (pip-audit 2.9.0) ==="
	requirements="$(mktemp)"
	trap 'rm -f "$requirements"' EXIT
	(cd backend && uv export --locked --all-extras --no-emit-project --no-hashes --format requirements-txt) > "$requirements"
	uvx --python 3.14.7 --from pip-audit==2.9.0 pip-audit --disable-pip --no-deps -r "$requirements"
	echo "=== TypeScript typecheck ==="
	(cd frontend && pnpm run typecheck)
	echo "=== Accepted risks check ==="
	bash tools/check-accepted-risks.sh
