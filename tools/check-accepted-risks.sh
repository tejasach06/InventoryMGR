#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTER="$ROOT/ACCEPTED_RISKS.md"
if [ ! -s "$REGISTER" ]; then
  echo "No accepted-risk register exists. No advisory exclusions are authorized."
  exit 0
fi
FAILED=0
if grep -q 'RISK-001' "$REGISTER"; then
  if grep -q 'HOST=0.0.0.0' "$ROOT/backend-rust/Dockerfile" && grep -q '0.0.0.0' "$ROOT/frontend/package.json"; then
    echo "[PASS] RISK-001 container bind matches Rust Dockerfile and frontend start script"
  else
    echo "[FAIL] RISK-001 bind changed. Re-evaluate the accepted risk."
    FAILED=1
  fi
fi
while IFS='|' read -r _ _ _ _ review_date _; do
  review_date="${review_date//[[:space:]]/}"
  [[ "$review_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  if [[ "$(date -u +%Y%m%d)" -gt "$(date -d "$review_date" +%Y%m%d)" ]]; then
    echo "[FAIL] Risk review date $review_date has passed"
    FAILED=1
  fi
done < "$REGISTER"
exit "$FAILED"
