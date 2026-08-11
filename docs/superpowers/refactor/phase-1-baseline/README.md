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

The backend pytest failure occurs during test collection before database use: `tests/test_accent_preference.py` reports `ImportError: attempted relative import with no known parent package`, and `tests/test_ldap_auth.py` reports `ModuleNotFoundError: No module named 'tests.conftest'`.
The audit failure occurs in `bun audit`, which reports 21 frontend dependency advisories (10 high, 11 moderate) before later audit steps run.

## Summary

Baseline quality-gate evidence captured for Task 2. No production code was changed.
