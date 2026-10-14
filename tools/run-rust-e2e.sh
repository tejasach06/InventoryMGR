#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.nub/bin:$HOME/.local/bin:$PATH"
work="$(mktemp -d)"
container="inventorymgr-e2e-$(basename "$work" | tr '[:upper:]' '[:lower:]')"
backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  for pid in "$frontend_pid" "$backend_pid"; do
    if [ -n "$pid" ]; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  podman rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

podman run --detach --name "$container" --publish 127.0.0.1::5432 --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=inventorymgr_e2e docker.io/library/postgres:17 >/dev/null
for attempt in {1..60}; do
  if podman exec "$container" pg_isready -U postgres -d inventorymgr_e2e >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 60 ]; then echo "Postgres readiness timed out" >&2; exit 1; fi
  sleep 1
done
db_port="$(podman port "$container" 5432/tcp)"
db_port="${db_port##*:}"
export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$db_port/inventorymgr_e2e"
export DATABASE_URL="$TEST_DATABASE_URL" APP_ENV=test HOST=127.0.0.1
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export BACKUP_DIR="$work/backups"
read -r backend_port frontend_port < <(python3 -c 'import socket; a=socket.socket(); b=socket.socket(); a.bind(("127.0.0.1",0)); b.bind(("127.0.0.1",0)); print(a.getsockname()[1], b.getsockname()[1])')
export INVENTORYMGR_API_URL="http://127.0.0.1:$backend_port"
export BASE_URL="http://127.0.0.1:$frontend_port"
export INVENTORYMGR_E2E_RUNNER=1
export CARGO_TARGET_DIR="$REPO_ROOT/backend-rust/target"
(cd backend-rust && cargo build --locked)
(cd frontend && nub run --node build)
mkdir -p frontend/.next/standalone/.next
cp -r frontend/.next/static frontend/.next/standalone/.next/
if [ -d frontend/public ]; then cp -r frontend/public frontend/.next/standalone/; fi
mkdir -p frontend/reports

setsid env PORT="$backend_port" "$CARGO_TARGET_DIR/debug/inventorymgr-backend" >"$work/backend.log" 2>&1 &
backend_pid=$!
setsid env PORT="$frontend_port" HOSTNAME=127.0.0.1 node frontend/.next/standalone/server.js >"$work/frontend.log" 2>&1 &
frontend_pid=$!
for attempt in {1..90}; do
  if ! kill -0 "$backend_pid" "$frontend_pid" 2>/dev/null; then
    cat "$work/backend.log" "$work/frontend.log" >&2
    exit 1
  fi
  if curl -fsS "$INVENTORYMGR_API_URL/api/health" >/dev/null 2>&1 && curl -fsS "$BASE_URL/login" >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 90 ]; then cat "$work/backend.log" "$work/frontend.log" >&2; exit 1; fi
  sleep 1
done
(cd frontend && node node_modules/@playwright/test/cli.js test "$@")
