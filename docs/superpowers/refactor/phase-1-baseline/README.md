# Phase 1 Baseline Audit

## Purpose

This directory records the behavior-preserving baseline for the evidence-gated refactoring program. Phase 1 makes no production-code changes.

## Environment

- Repository root: `/home/tejas/project/InventoryMGR`
- Branch: `dev`
- Spec: `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md`
- Command runner: `devbox run -- <command>`

## Command Results

| Command | Status | Evidence |
|---|---:|---|
| `cd backend && uv run ruff check app tests` | PASS (status 0) | `raw/backend-ruff.txt` |
| `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest` | FAIL (status 2; pre-existing collection errors) | `raw/backend-pytest.txt` |
| `cd frontend && bun run lint && bun run typecheck` | PASS (status 0) | `raw/frontend-lint-typecheck.txt` |
| `cd frontend && bun run test` | PASS (status 0) | `raw/frontend-vitest.txt` |
| `just audit` | FAIL (status 1; pre-existing dependency advisories) | `raw/audit.txt` |
| `cd backend && uv run ruff check app tests --select F401,F841,F821` | PASS (status 0; no unused diagnostics emitted) | `raw/backend-unused-diagnostics.txt` |
| `cd frontend && bun run typecheck` | PASS (status 0; no unused diagnostics emitted) | `raw/frontend-unused-diagnostics.txt` |
| `graphify query backend/frontend/dead-code structure` | PASS (status 0) | `raw/graphify-backend-structure.txt`, `raw/graphify-frontend-structure.txt`, `raw/graphify-dead-code.txt`, `raw/graphify-csv-structure.txt` |
| `python3 tracked-file line inventory` | PASS (status 0) | `raw/tracked-file-lines.tsv` |

The backend pytest failure occurs during test collection before database use: `tests/test_accent_preference.py` reports `ImportError: attempted relative import with no known parent package`, and `tests/test_ldap_auth.py` reports `ModuleNotFoundError: No module named 'tests.conftest'`.
The audit failure occurs in `bun audit`, which reports 21 frontend dependency advisories (10 high, 11 moderate) before later audit steps run.

## Summary

Baseline quality-gate evidence captured for Task 2. No production code was changed.


## Structure Findings

- Suspected findings: 3
- Confirmed findings: 0
- Ambiguous findings: 1
- Rejected findings: 0

The highest-risk suspected findings are backend VM service boundaries, CSV import boundaries, and InventoryPage route boundaries. No production-code change is authorized by Phase 1 alone.

TypeScript typecheck and Ruff unused-code diagnostics produced no unused application-code findings. The only dead-code-related ledger entry remains ambiguous because graphify surfaced large repository tooling scripts without proving absence of tracked imports, calls, script entries, deployment references, or documented operational use.

## Performance Baseline

| Area | Command | Status | Evidence |
|---|---|---:|---|
| Frontend bundle | `cd frontend && bun run build` | PASS (status 0) | `raw/frontend-build.txt` |
| Frontend coverage | `cd frontend && bun run test -- --coverage` | FAIL (status 1; coverage thresholds unmet) | `raw/frontend-coverage.txt` |
| Backend endpoint durations | `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_dashboard.py tests/test_reports.py tests/test_vm_filters.py -q --durations=20` | FAIL (status 4; named tests missing) | `raw/backend-durations.txt` |

Frontend coverage ran 243 tests successfully, then failed the configured global coverage thresholds: lines 79.51%, functions 71.74%, statements 76.74%, and branches 69.66%.
Backend endpoint timing could not produce durations because all named endpoint baseline files are absent from the tracked test suite: `tests/test_dashboard.py`, `tests/test_reports.py`, and `tests/test_vm_filters.py`. No existing subset of those named files was available to rerun.

Later performance phases must compare against these commands or document a stricter replacement baseline before optimizing.

## Finalization Checks

- Placeholder review: PASS (`phase-1 docs have no forbidden placeholders`).
- Ledger status review: PASS (`validated 4 ledger rows`).
- Final `graphify update .`: FAIL (status 1). Graphify refused to overwrite because the new graph has 4403 nodes while existing `graph.json` has 4878: `WARNING: new graph has 4403 nodes but existing graph.json has 4878. Refusing to overwrite — you may be missing chunk files from a previous session. Pass --force to override.` No force update was run.

## Recommended Next Phase

Recommended next phase: Phase 3 — backend service restructuring characterization and planning.

Rationale: REF-002 (`backend/app/services/csv_import.py`) and REF-001 (`backend/app/services/vms.py`) have the strongest Phase 1 evidence because they are the largest application service files and graphify ties them to multiple high-value invariants: CSV round-trip behavior, additive child records, duplicate detection, audit logging, health score recomputation, and VM list/filter behavior. REF-003 is also a valid frontend restructuring candidate, but its medium risk and narrower UI boundary make it a better follow-up after the higher-risk backend service seams are characterized. REF-004 remains ambiguous and does not justify Phase 2 dead-code removal.

Phase 1 does not authorize production-code changes. A separate implementation plan is required before Phase 2, Phase 3, Phase 4, or Phase 5 begins.
