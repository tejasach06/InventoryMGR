# Branch Split Design: `dev` / `main`

## Topology
- `dev`: Full codebase.
- `main`: Runtime only (dev files gitignored).

## Gitignored on `main` (list)
backend/tests/
frontend/src/test/
frontend/e2e/
docs/
!docs/RUNBOOK.md
DESIGN.md
PRODUCT.md
AGENTS.md
justfile
devbox.json
devbox.lock
frontend/eslint.config.mjs
frontend/vitest.config.ts
frontend/playwright.config.ts
graphify-out/
.impeccable/
.superpowers/
tools/
reports/
sample-import.csv
create-placeholders.sh
ACCEPTED_RISKS.md
README.md
CONTRIBUTING.md
backend/.ruff_cache/
backend/.pytest_cache/
backend/test.db
backend/inventorymgr.db
frontend/tsconfig.tsbuildinfo
frontend/test-results/
frontend/test-api-direct.mjs
frontend/test-mock-data.mjs
frontend/direct-page-check.mjs
frontend/reports/
docker-compose.e2e.yml
mempalace.yaml
entities.json
.mcp.json
