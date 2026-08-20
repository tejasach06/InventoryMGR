#!/usr/bin/env bash
# tools/omp-refactor.sh <module>
# Runs the omp test-then-refactor pipeline for one backend/app module.
# Exit 0 = both passes green and committed. Exit 1 = a pass failed pytest;
# tree is left dirty for inspection, nothing is committed for that pass.
set -euo pipefail

MODULE="${1:?usage: omp-refactor.sh <module>}"
LOG="backend/omp-refactor.log"

run_pytest() {
  (cd backend && APP_ENV=test DATABASE_URL="${TEST_DATABASE_URL:-}" uv run pytest "tests/" -k "$MODULE")
}

run_pass() {
  local pass_name="$1" prompt="$2" commit_prefix="$3"
  echo "== $MODULE: $pass_name pass ==" | tee -a "$LOG"
  omp "$prompt" >>"$LOG" 2>&1 || true  # omp's own exit status is not trusted

  if ! run_pytest; then
    echo "RED: $MODULE $pass_name pass failed pytest — stopping, tree left dirty. See $LOG." >&2
    return 1
  fi

  git add "backend/app/$MODULE" "backend/tests/"
  if git diff --cached --quiet; then
    echo "note: $pass_name pass made no changes to commit for $MODULE" | tee -a "$LOG"
  else
    git commit -qm "$commit_prefix($MODULE): omp $pass_name pass"
  fi
  echo "GREEN: $MODULE $pass_name pass" | tee -a "$LOG"
}

run_pass "test" \
  "In backend/app/$MODULE, using skill investigate-first, add missing pytest coverage for exported behavior, following backend/tests/conftest.py conventions. Run pytest tests/ -k $MODULE until green." \
  "test" || exit 1

run_pass "refactor" \
  "Refactor backend/app/$MODULE using skill safe-refactor: tests written in the test pass are the safety net, bracket every edit with a test run, no behavior change. Run pytest tests/ -k $MODULE until green." \
  "refactor" || exit 1

echo "DONE: $MODULE" | tee -a "$LOG"
