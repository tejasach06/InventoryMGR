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


## Replacement Baseline Results

Baseline source commit: `bd9f6c3fb2a2078fb52dcc554e85135b055d6034`. Repeat source commit: `bd9f6c3fb2a2078fb52dcc554e85135b055d6034`. Backend raw commit: `bd9f6c3fb2a2078fb52dcc554e85135b055d6034`.


### Backend Endpoint Baseline

| Endpoint | Median duration (ms) | Median query count | Duration CV | Timing stable |
|---|---:|---:|---:|---|
| dashboard | 11.491 | 10 | 0.0762 | false |
| reports_summary | 5.605 | 10 | 1.1633 | false |
| vm_list | 9.983 | 6 | 0.0490 | true |

### Frontend Route Baseline

| Route | Median duration (ms) | Median transfer bytes | Duration CV | Timing stable |
|---|---:|---:|---:|---|
| /dashboard | 30.600 | 869858 | 0.0535 | false |
| /inventory | 32.700 | 1176446 | 0.0396 | true |
| /reports | 30.300 | 869654 | 0.0928 | false |

### Bundle Baseline

| Metric | Value |
|---|---:|
| JavaScript chunk gzip bytes | 355436 |

### Repeatability Check

| Metric | Baseline | Repeat | Change |
|---|---:|---:|---:|
| backend dashboard queries | 10 | 10 | +0 |
| backend reports_summary queries | 10 | 10 | +0 |
| backend vm_list queries | 6 | 6 | +0 |
| frontend /dashboard transfer bytes | 869858 | 869858 | +0 |
| frontend /inventory transfer bytes | 1176446 | 1176446 | +0 |
| frontend /reports transfer bytes | 869654 | 869654 | +0 |
| bundle gzip bytes | 355436 | 355436 | +0 |

Timing CV exceeded 5% for dashboard, reports_summary, `/dashboard`, and `/reports` after the controlled repeat. Timing-only candidates are therefore rejected for this phase; deterministic query-count and byte-count evidence remains usable.


This committed baseline supersedes the invalid Phase 1 backend duration attempt. Frontend coverage remains a known quality-gate blocker and was not reclassified as performance evidence.
