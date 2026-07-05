#!/bin/bash
# tools/check-accepted-risks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0

echo "--- Checking accepted risks ---"

# RISK-001: Docker containers bind to 0.0.0.0 (required for container networking)
if grep -q "0.0.0.0" "$ROOT/backend/Dockerfile" && grep -q "0.0.0.0" "$ROOT/frontend/package.json"; then
  echo "  [PASS] RISK-001: 0.0.0.0 bind present in backend Dockerfile and frontend start script (expected)"
else
  # If the pattern changed, the risk may no longer apply — flag for review
  echo "  [WARN] RISK-001: 0.0.0.0 bind pattern changed — re-evaluate whether risk still applies"
fi

# Check review dates
while IFS='|' read -r _ _ _ review_date _ _; do
  # Skip non-data lines (header, separator)
  [[ "$review_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  if [[ "$(date -u +%Y%m%d)" -gt "$(date -d "$review_date" +%Y%m%d 2>/dev/null)" ]]; then
    echo "  [FAIL] Risk review date $review_date has passed — must re-evaluate"
    FAILED=1
  fi
done < "$ROOT/ACCEPTED_RISKS.md"

if [ "$FAILED" -eq 1 ]; then
  echo "--- One or more accepted risks need re-evaluation ---"
  exit 1
fi
echo "--- All accepted risks are current ---"
