# Dependency Security Audit & Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit InventoryMGR's full dependency surface and upgrade to secure, stable versions (runtimes/base images to n-1 of latest LTS/stable, libraries case-by-case by breaking-change risk) without introducing unreviewed breakage.

**Architecture:** Single branch `chore/deps-upgrade` off `dev`, phased commits (audit → runtimes/base images → backend libs → frontend libs → final gate), one PR into `dev`. Each phase independently revertable.

**Tech Stack:** uv (Python), Bun (Node/Next.js), devbox, Docker/Podman, osv-scanner (one-time), pytest/ruff/mypy, vitest/eslint/tsc/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-dependency-security-upgrade-design.md`

## Global Constraints

- All work happens on branch `chore/deps-upgrade`, branched from `dev`. Never commit directly to `dev` or `main`.
- Runtimes/base images target n-1 of current latest LTS/stable (Python, Node, Postgres). Libraries default to latest stable; any major-version jump gets an explicit one-line risk note before bumping.
- `next@16.2.11` currently pairs with `react@18.2.0`/`react-dom@18.2.0` — this MUST be fixed to React 19 regardless of the case-by-case policy (Next 16 requires React 19).
- No new permanent tooling/CI infra. `osv-scanner` runs once as a manual cross-check; only add it to `justfile`/CI if it finds something `uv audit`/`bun audit` miss.
- `ACCEPTED_RISKS.md` entries are not to be added for "haven't upgraded yet" — only genuine new permanent tradeoffs.
- Every phase must pass its own verification before moving to the next; final gate is full `just verify` + `just audit`.
- Breaking changes surfaced by a bump are fixed as part of this work, scoped to what's needed for the upgraded version to function — not broader refactors. If a bump requires a disproportionately large rewrite, stop and flag rather than silently expanding or skipping.

---

### Task 1: Create branch and capture audit baseline

**Files:**
- Create: `docs/superpowers/plans/artifacts/2026-08-14-audit-baseline.md` (baseline findings + version target table — working document for this upgrade, not a permanent doc)

**Interfaces:**
- Produces: `docs/superpowers/plans/artifacts/2026-08-14-audit-baseline.md` containing (a) baseline `just audit` output, (b) `osv-scanner` cross-check output, (c) a table of every in-scope package with current version, proposed target version, and one-line rationale (required for every major-version jump). Later tasks read the target versions from this table — do not re-decide them ad hoc.

- [ ] **Step 1: Create the branch**

```bash
git checkout dev
git pull
git checkout -b chore/deps-upgrade
```

- [ ] **Step 2: Run baseline security audit**

```bash
just audit 2>&1 | tee /tmp/audit-baseline.txt
```

Record full output (both `bun audit` and `uv audit` sections) into the artifact file under a `## Baseline just audit` heading.

- [ ] **Step 3: Run osv-scanner cross-check**

```bash
which osv-scanner || brew install osv-scanner || (echo "install via https://github.com/google/osv-scanner/releases if brew unavailable")
osv-scanner --lockfile=backend/uv.lock 2>&1 | tee /tmp/osv-backend.txt
osv-scanner --lockfile=frontend/bun.lock 2>&1 | tee /tmp/osv-frontend.txt || echo "bun.lock format may be unsupported by osv-scanner; note this in the artifact and skip"
```

Record output under `## osv-scanner cross-check`. If `osv-scanner` finds nothing `uv audit`/`bun audit` didn't already flag, write one line: "No incremental findings beyond just audit; not adding to CI." If it does find something new, list it as a required-fix item.

- [ ] **Step 4: Diff findings against ACCEPTED_RISKS.md**

```bash
cat ACCEPTED_RISKS.md
```

For each finding from Steps 2-3, check whether it matches an existing accepted-risk entry. List unmatched findings under `## Required fixes (not accepted risks)` in the artifact — these must be resolved by a version bump in later tasks, not added to `ACCEPTED_RISKS.md`.

- [ ] **Step 5: Determine current vs. latest vs. n-1 for runtimes**

Check current latest stable/LTS lines:
- Python: check https://www.python.org/downloads/ for latest stable minor; devbox pins `python@3.12`. If latest is 3.14, n-1 target is 3.13; if latest is still 3.13, current 3.12 pin is already n-1 (no change).
- Node: check https://nodejs.org/en/about/previous-releases for current LTS; devbox pins `nodejs@22`. Determine current n-1 LTS line (e.g. if 24 is now Active LTS and 22 is Maintenance, decide whether 22 is still the n-1 target or whether to move to 22's successor per policy — n-1 of latest LTS, not "still supported").
- Postgres: check https://www.postgresql.org/support/versioning/ for latest major; docker-compose pins Postgres 16. Determine n-1 target.

Record each as a row in the version target table: `| Package | Current | Target | Rationale |`.

- [ ] **Step 6: Determine library targets**

For each dependency in `backend/pyproject.toml` and `frontend/package.json`, check latest stable release (via `uv pip list --outdated` equivalent / `bun outdated` / checking PyPI/npm directly):

```bash
cd backend && uv pip list --outdated 2>&1 | tee /tmp/backend-outdated.txt
cd ../frontend && bun outdated 2>&1 | tee /tmp/frontend-outdated.txt
```

For every package with a major-version jump available, add a table row with target = latest stable and a one-line rationale, OR target = current (hold) with a one-line reason if the major jump is high-risk and should be deferred as follow-up (only if truly disproportionate per Global Constraints — otherwise fix it now per the spec's "fix breakages as part of this plan" decision). Explicitly confirm the React 18→19 fix is in the table as a required item, not optional.

- [ ] **Step 7: Commit the baseline artifact**

```bash
git add docs/superpowers/plans/artifacts/2026-08-14-audit-baseline.md
git commit -m "chore(deps): capture audit baseline and version target table"
```

---

### Task 2: Bump runtimes and base images

**Files:**
- Modify: `devbox.json`
- Modify: `backend/Dockerfile`
- Modify: `frontend/Dockerfile`
- Modify: `docker-compose.yml`, `docker-compose.e2e-db.yml` (Postgres image tag)

**Interfaces:**
- Consumes: version target table from Task 1's artifact (rows for Python, Node, Postgres, base image digests).
- Produces: updated runtime pins that Task 3 (backend libs) and Task 4 (frontend libs) build on top of.

- [ ] **Step 1: Update devbox.json runtime versions**

Edit the `packages` array in `devbox.json` to the target Python/Node versions from the Task 1 table, e.g.:

```json
"packages": [
  "python@<target>",
  "nodejs@<target>",
  "uv",
  "just"
]
```

- [ ] **Step 2: Update backend Dockerfile base image**

In `backend/Dockerfile`, change:

```dockerfile
FROM python:3.12-slim-bookworm AS base
```

to the target Python version's slim-bookworm (or current Debian codename) tag from the table.

- [ ] **Step 3: Update frontend Dockerfile base image**

`frontend/Dockerfile` uses `oven/bun:latest` for both stages — this floats already. Pin it to a specific version tag matching Bun's current stable release (check `bun --version` output after devbox/bun reinstall) instead of `latest`, to make the build reproducible: `oven/bun:<version>`.

- [ ] **Step 4: Update Postgres image tag**

In `docker-compose.yml` and `docker-compose.e2e-db.yml`, change the Postgres service image tag (e.g. `postgres:16` → target from table).

- [ ] **Step 5: Reinstall devbox environment and verify runtimes**

```bash
devbox shell
python --version
node --version
uv --version
```

Confirm output matches the target versions.

- [ ] **Step 6: Rebuild and boot the stack to verify base images**

```bash
just up
curl -f http://localhost:8000/api/health
curl -f http://localhost:3000/
just down 2>/dev/null || docker compose down
```

Expected: both healthchecks succeed (adjust ports per `docker-compose.yml` if non-default).

- [ ] **Step 7: Commit**

```bash
git add devbox.json backend/Dockerfile frontend/Dockerfile docker-compose.yml docker-compose.e2e-db.yml
git commit -m "chore(deps): bump runtimes and base images to n-1 stable"
```

---

### Task 3: Bump backend library dependencies and fix breakages

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Modify: any `backend/app/**` or `backend/tests/**` files broken by the bump (exact paths determined by what fails in Step 3 below — cannot be enumerated ahead of the actual upgrade)

**Interfaces:**
- Consumes: backend library target versions from Task 1's artifact table; runtime versions from Task 2 (`requires-python` in `pyproject.toml` must match).
- Produces: passing `backend/tests/` suite and `uv run ruff check` / `mypy` clean, consumed by Task 5's final gate.

- [ ] **Step 1: Update requires-python if runtime changed**

If Task 2 changed the Python target, update `backend/pyproject.toml`:

```toml
requires-python = ">=<target>"
```

And `[tool.ruff] target-version` / `[tool.mypy] python_version` to match.

- [ ] **Step 2: Upgrade locked dependencies to target versions**

```bash
cd backend
uv lock --upgrade
uv sync --extra dev
```

If specific packages need pinning to the Task 1 table's target rather than uv's resolved latest (e.g. holding a package back per the rationale column), edit `pyproject.toml` dependency specifiers accordingly and re-run `uv lock`.

- [ ] **Step 3: Run full backend verification and fix breakages**

```bash
uv run ruff check app tests
uv run mypy app
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -v
```

For each failure: read the actual error (deprecated API, changed signature, changed default), fix the calling code in `backend/app/` (never suppress/ignore the error), re-run the specific failing test until it passes, then re-run the full suite. Do not proceed to Step 4 until `ruff`, `mypy`, and `pytest` are all clean.

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app backend/tests
git commit -m "chore(deps): upgrade backend dependencies and fix breakages"
```

---

### Task 4: Bump frontend library dependencies (including React 19) and fix breakages

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/bun.lock`
- Modify: any `frontend/src/**` files broken by the bump (exact paths determined by what fails in Step 3 below)

**Interfaces:**
- Consumes: frontend library target versions from Task 1's artifact table (must include `react`/`react-dom` → 19.x as a required item, not optional).
- Produces: passing `vitest`, `eslint`, `tsc --noEmit`, consumed by Task 5's final gate.

- [ ] **Step 1: Upgrade dependencies to target versions**

```bash
cd frontend
bun add react@<target> react-dom@<target>
bun add next@<target> @tanstack/react-query@<target> zod@<target> typescript@<target>
bun add -d @types/react@<target> @types/react-dom@<target> tailwindcss@<target> @tailwindcss/postcss@<target> eslint@<target> typescript-eslint@<target> vitest@<target> @vitest/coverage-v8@<target> @testing-library/react@<target> @testing-library/jest-dom@<target> @testing-library/user-event@<target> @playwright/test@<target> jsdom@<target> @types/node@<target> @eslint/js@<target> eslint-plugin-tailwindcss@<target>
```

Fill in each `<target>` from the Task 1 table. Then update `overrides` in `package.json` (`nanoid`, `postcss`, `sharp`, `undici`) if the audit found newer minimum-safe versions.

- [ ] **Step 2: Update @types/react and @types/react-dom to match React 19**

Confirm `@types/react` and `@types/react-dom` in `devDependencies` are the 19.x-compatible major (types packages must track the runtime major).

- [ ] **Step 3: Run full frontend verification and fix breakages**

```bash
bun run lint
bun run typecheck
bun run test
```

For each failure: read the actual error. Common React 19 migration items to check explicitly: removed `PropTypes`/`defaultProps` on function components, `ReactDOM.render` → `createRoot` (if used anywhere outside Next's own bootstrap), changed `useRef` typing requiring an initial value, any Next.js 16 App Router API changes (check Next's release notes for the specific version bumped to). Fix the calling code in `frontend/src/`, re-run the specific failing check, then the full set. Do not proceed until lint, typecheck, and test are all clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/bun.lock frontend/src
git commit -m "chore(deps): upgrade frontend dependencies to React 19 and fix breakages"
```

---

### Task 5: Final verification gate and PR

**Files:**
- Modify: `ACCEPTED_RISKS.md` only if a version bump changes something its checker script verifies (e.g. the Dockerfile `0.0.0.0` grep count in RISK-001) — otherwise no change.

**Interfaces:**
- Consumes: all prior tasks' committed state on `chore/deps-upgrade`.
- Produces: a branch ready for PR into `dev`.

- [ ] **Step 1: Run the full verify gate**

```bash
just verify
```

Expected: `ruff check`, `pytest`, `bun lint`, `bun typecheck`, `vitest`, `playwright` all pass. If Playwright fails due to a version-bump-related selector/API change, fix `frontend/e2e/*.spec.ts` and re-run.

- [ ] **Step 2: Run the full audit gate**

```bash
just audit
```

Expected: no new findings beyond what's already in `ACCEPTED_RISKS.md`. Compare against the Task 1 baseline — every "Required fixes (not accepted risks)" item from the artifact must now be resolved.

- [ ] **Step 3: Verify ACCEPTED_RISKS.md checker still passes**

```bash
tools/check-accepted-risks.sh
```

If RISK-001's grep-based check breaks because a Dockerfile line changed incidentally during the bump, update the check command in `ACCEPTED_RISKS.md` to match the new (still-equivalent) line, not the risk's rationale.

- [ ] **Step 4: Smoke-test the full stack**

```bash
just up-local
curl -f http://localhost:8000/api/health
curl -f http://localhost:3000/
```

Manually verify login + one CRUD action (e.g. list VMs) works via browser before tearing down.

- [ ] **Step 5: Commit any final fixups and open PR**

```bash
git add -A
git commit -m "chore(deps): final verification fixups" --allow-empty
git push -u origin chore/deps-upgrade
gh pr create --base dev --head chore/deps-upgrade \
  --title "chore(deps): security audit and dependency upgrade" \
  --body "$(cat docs/superpowers/plans/artifacts/2026-08-14-audit-baseline.md)"
```

- [ ] **Step 6: Await review, merge into dev**

After PR approval:

```bash
git checkout dev
git pull
git merge --no-ff chore/deps-upgrade
git push origin dev
```

Follow the existing dev→main sync convention (merge dev into main, resolve `.gitignore`-driven conflicts by keeping main's side, prune newly-ignored files) separately, per project convention — not part of this plan.
