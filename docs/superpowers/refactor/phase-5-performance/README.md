# Phase 5 Measured Performance Optimization

## Replacement Baseline Rationale

The Phase 1 backend timing command ran no tests because `test_dashboard.py`, `test_reports.py`, and `test_vm_filters.py` were absent. This phase replaces it with a committed deterministic benchmark harness. The Phase 1 frontend coverage run is a known quality-gate failure, not a performance baseline and not permission to lower thresholds.

## Environment

| Field | Value |
|---|---|
| Git commit | 8f4ae21cdabfa7bb5f41a7e6131431f76c1b9f38 |
| Python | Python 3.12.13 |
| uv | uv 0.11.32 (x86_64-unknown-linux-gnu) |
| Bun | 1.3.14 |
| Node | v22.22.3 |
| Database | PostgreSQL test database at `127.0.0.1:54329/inventorymgr_test` |
| Backend samples | 5 warm-ups, 30 recorded samples per endpoint |
| Frontend samples | 3 warm-ups, 15 recorded samples per route |

## Preflight Gates

| Gate | Result |
|---|---|
| Backend Ruff | Pass: `All checks passed!` |
| Frontend lint/typecheck/unit tests | Pass: 37 files, 251 tests passed |
| Frontend coverage | Known failure: statements 80.03%, branches 74.1%, functions 74.77%, lines 82.62%; branch and function coverage remain below the configured 80% threshold |
| Frontend production build | Pass: Next.js production build compiled successfully |

## Preflight Notes

`devbox run -- just db-up` reported `rootlessport listen tcp 127.0.0.1:54329: bind: address already in use`; the existing PostgreSQL listener on `127.0.0.1:54329` was validated by `APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head` and `uv run alembic current`, which reported `0022 (head)`.
