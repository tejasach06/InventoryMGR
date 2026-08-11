# Measured Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish trustworthy replacement performance baselines, select only measured bottlenecks, and authorize separately reviewable optimizations only when the repository's 10% improvement and 5% regression rules are satisfied.

**Architecture:** This phase has a hard evidence boundary: first add deterministic backend and frontend benchmark harnesses, then measure repeatability, then write a selection record. Production code remains out of scope until a candidate-specific bounded implementation task is derived from the captured evidence and approved; an empty candidate set ends the phase successfully without code changes.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL 16, Pytest, Next.js, React 18, Vitest, Playwright, Bun, Python 3.12, Devbox, Just, Graphify, Git.

## Global Constraints

- Prerequisite: complete the backend test-harness, CSV import, VM service, and Inventory page plans with green final gates before capturing replacement baselines.
- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Do not treat `docs/superpowers/refactor/phase-1-baseline/raw/backend-durations.txt` as a backend baseline: its three requested test files did not exist and no tests ran.
- Do not treat the failing Phase 1 coverage run as a passing quality gate: 243 tests passed, but lines 79.51%, functions 71.74%, statements 76.74%, and branches 69.66% were below the configured 80% thresholds.
- Run every project command inside Devbox with `devbox run -- ...` from the repository root.
- Use the same database fixture, build mode, environment variables, warm-up count, sample count, and result parser for before/after comparisons.
- Accept a timing optimization only when its repeatable median improves by at least 10%.
- A repeatable timing regression of 5% or more blocks the candidate.
- Increased query counts or bundle bytes block the candidate unless a separate, explicit contract-preserving trade-off is approved.
- Deterministic reductions in query count or transferred/bundled bytes may qualify without a timing claim.
- Do not change production code merely because a module is large or an optimization is theoretically faster.
- If measurements have a coefficient of variation above 5%, control the environment and repeat them; if they remain unstable, reject the timing candidate.
- Each selected candidate gets a bounded, independently reviewable implementation plan and rollback commit; do not combine unrelated backend and frontend candidates.
- If no candidate meets the selection rules, record that result, update the ledger, and stop without a production-code commit.
- Do not delete, rewrite, or stage pre-existing untracked files.
- `docs/`, `backend/tests/`, `frontend/src/test/`, and `frontend/e2e/` are ignored on the deploy-aligned branch; stage intentional additions there with `git add -f`.
- Use `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md` as the acceptance source of truth.

---

## File Structure

- Create: `backend/tests/performance/__init__.py` — makes the backend performance suite importable.
- Create: `backend/tests/performance/test_endpoint_performance.py` — deterministic dashboard, reports-summary, and VM-list query-count/timing benchmark harness.
- Create: `frontend/e2e/performance.spec.ts` — production-mode navigation transfer and timing sampler for dashboard, reports, and inventory.
- Create: `tools/summarize-performance.py` — validates sample metadata, calculates medians and coefficient of variation, and compares before/after JSON.
- Create: `docs/superpowers/refactor/phase-5-performance/README.md` — controlled-environment description, commands, selection decision, and phase result.
- Create: `docs/superpowers/refactor/phase-5-performance/baseline.json` — replacement baseline consumed by later candidate comparisons.
- Create when evidence selects a candidate: `docs/superpowers/plans/2026-08-12-performance-candidate-perf-001.md` — the plan for the single highest-ranked qualifying candidate, containing exact production files, characterization tests, measured acceptance values, rollback, and commands.
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md` — records candidate selection, rejection, or resolution evidence.
- Modify only in a separately approved candidate plan: the exact production and characterization-test files demonstrated by its profile.

---

### Task 1: Record the replacement-baseline preflight

**Files:**
- Create: `docs/superpowers/refactor/phase-5-performance/README.md`

**Interfaces:**
- Consumes: Phase 1 README, ledger, raw performance logs, `justfile`, `backend/pyproject.toml`, `frontend/package.json`, `frontend/vitest.config.ts`, and `frontend/playwright.config.ts`.
- Produces: A dated environment and gate record that explicitly supersedes the invalid Phase 1 timing baseline.

- [ ] **Step 1: Confirm repository state and tool versions**

Run:

```bash
devbox run -- bash -lc 'git status --short --branch; python3 --version; uv --version; bun --version; node --version; git rev-parse HEAD'
```

Expected: the branch and exact commit are printed with Python, uv, Bun, and Node versions. Stop if tracked changes are unrelated to this phase.

- [ ] **Step 2: Start and validate the test database**

Run:

```bash
devbox run -- just db-up
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic current'
```

Expected: PostgreSQL reports ready and Alembic reports the repository head revision. Stop on migration failure.

- [ ] **Step 3: Reproduce the known quality state without hiding failures**

Run:

```bash
devbox run -- bash -lc 'cd backend && uv run ruff check app tests'
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck && bun run test'
devbox run -- bash -lc 'cd frontend && bun run test -- --coverage'; test $? -eq 1
devbox run -- bash -lc 'cd frontend && bun run build'
```

Expected: Ruff, frontend lint/typecheck/unit tests, and the production build pass. The coverage command is expected to exit 1 only for the already-recorded 80% threshold miss; any test failure or different error is a new blocker. Do not weaken `frontend/vitest.config.ts`.

- [ ] **Step 4: Write the preflight record**

Create `docs/superpowers/refactor/phase-5-performance/README.md` with these exact headings and the actual command output values:

```markdown
# Phase 5 Measured Performance Optimization

## Replacement Baseline Rationale

The Phase 1 backend timing command ran no tests because `test_dashboard.py`, `test_reports.py`, and `test_vm_filters.py` were absent. This phase replaces it with a committed deterministic benchmark harness. The Phase 1 frontend coverage run is a known quality-gate failure, not a performance baseline and not permission to lower thresholds.

## Environment

| Field | Value |
|---|---|
| Git commit | exact 40-character commit |
| Python | exact version |
| uv | exact version |
| Bun | exact version |
| Node | exact version |
| Database | PostgreSQL test database at `127.0.0.1:54329/inventorymgr_test` |
| Backend samples | 5 warm-ups, 30 recorded samples per endpoint |
| Frontend samples | 3 warm-ups, 15 recorded samples per route |

## Preflight Gates

| Gate | Result |
|---|---|
| Backend Ruff | actual result |
| Frontend lint/typecheck/unit tests | actual result |
| Frontend coverage | known failure with the four actual percentages |
| Frontend production build | actual result |
```

Expected: no generic result text remains; values match the current run.

- [ ] **Step 5: Commit the preflight record**

Run:

```bash
git add -f docs/superpowers/refactor/phase-5-performance/README.md
git diff --cached --check
git commit -m "docs: record performance phase preflight"
```

Expected: a documentation-only commit succeeds.

---

### Task 2: Add deterministic backend endpoint measurements

**Files:**
- Create: `backend/tests/performance/__init__.py`
- Create: `backend/tests/performance/test_endpoint_performance.py`
- Test: `backend/tests/performance/test_endpoint_performance.py`

**Interfaces:**
- Consumes: `app.main:app`, SQLAlchemy engine/session configuration, existing authentication helpers or equivalent locally defined login setup, and the PostgreSQL test database.
- Produces: `backend-performance.json` with schema `{metadata, endpoints}`, where each endpoint has `query_counts: number[]`, `durations_ms: number[]`, `median_queries: number`, and `median_duration_ms: number`.

- [ ] **Step 1: Write the benchmark test with fixed fixtures and output schema**

Create `backend/tests/performance/test_endpoint_performance.py` so that it:

```python
WARMUPS = 5
SAMPLES = 30
VM_COUNT = 200
ENDPOINTS = {
    "dashboard": "/api/dashboard",
    "reports_summary": "/api/reports/summary",
    "vm_list": "/api/vms?page=1&page_size=100&sort=name&direction=asc",
}
```

The module must reset the public schema, run Alembic to head, create one admin user, insert exactly 200 VMs with deterministic names `perf-vm-000` through `perf-vm-199`, log in once, and reuse the authenticated client. Attach SQLAlchemy `before_cursor_execute`/`after_cursor_execute` listeners only around each request, use `time.perf_counter_ns()`, discard five warm-ups, record thirty samples per endpoint, assert every response is 200, assert every sample returns the expected response shape, and write sorted JSON to the path from `PERF_OUTPUT`. Do not assert a speed threshold in the benchmark itself.

- [ ] **Step 2: Verify collection before measuring**

Run:

```bash
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest --collect-only -q tests/performance/test_endpoint_performance.py'
```

Expected: the performance test collects successfully. This replaces the Phase 1 command that named absent files.

- [ ] **Step 3: Run the backend baseline on an idle local environment**

Run:

```bash
mkdir -p docs/superpowers/refactor/phase-5-performance/raw
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" PERF_OUTPUT=../docs/superpowers/refactor/phase-5-performance/raw/backend-performance.json uv run pytest -q tests/performance/test_endpoint_performance.py'
```

Expected: PASS and `raw/backend-performance.json` contains 30 duration and query-count samples for each of the three endpoints.

- [ ] **Step 4: Validate backend sample completeness**

Run:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path('docs/superpowers/refactor/phase-5-performance/raw/backend-performance.json')
data = json.loads(p.read_text())
assert set(data['endpoints']) == {'dashboard', 'reports_summary', 'vm_list'}
for name, result in data['endpoints'].items():
    assert len(result['durations_ms']) == 30, name
    assert len(result['query_counts']) == 30, name
    assert all(value > 0 for value in result['durations_ms']), name
    assert all(isinstance(value, int) and value >= 0 for value in result['query_counts']), name
print('backend performance samples valid')
PY
```

Expected: prints `backend performance samples valid`.

- [ ] **Step 5: Commit the backend harness**

Run:

```bash
git add -f backend/tests/performance/__init__.py backend/tests/performance/test_endpoint_performance.py
git diff --cached --check
git commit -m "test: add backend performance harness"
```

Expected: only the ignored test files are committed; no application code changes are staged.

---

### Task 3: Add deterministic frontend bundle and route measurements

**Files:**
- Create: `frontend/e2e/performance.spec.ts`
- Test: `frontend/e2e/performance.spec.ts`

**Interfaces:**
- Consumes: Playwright's existing authenticated application setup and the built Next.js application.
- Produces: `frontend-performance.json` with `bundle_gzip_bytes` plus 15 `duration_ms` and `transfer_bytes` samples for `/dashboard`, `/reports`, and `/inventory`.

- [ ] **Step 1: Write the production-route benchmark**

Create `frontend/e2e/performance.spec.ts` with constants:

```typescript
const warmups = 3;
const samples = 15;
const routes = ['/dashboard', '/reports', '/inventory'] as const;
```

The test must authenticate once, perform three discarded navigations per route, then fifteen measured `page.goto(route, { waitUntil: 'networkidle' })` navigations. For each sample, record `performance.getEntriesByType('navigation')[0].duration` and sum response body byte lengths for same-origin JavaScript, CSS, document, and API responses. Write JSON to `PERF_OUTPUT`; do not assert a speed threshold in the benchmark.

- [ ] **Step 2: Build once and calculate deterministic compressed bundle bytes**

Run:

```bash
devbox run -- bash -lc 'cd frontend && rm -rf .next && bun run build'
python3 - <<'PY' > docs/superpowers/refactor/phase-5-performance/raw/frontend-bundle.json
import gzip, json
from pathlib import Path
files = sorted(Path('frontend/.next/static/chunks').rglob('*.js'))
assert files
rows = {str(p.relative_to('frontend/.next')): len(gzip.compress(p.read_bytes(), mtime=0)) for p in files}
print(json.dumps({'bundle_gzip_bytes': sum(rows.values()), 'chunks': rows}, sort_keys=True, indent=2))
PY
```

Expected: the production build passes and the JSON records every JavaScript chunk plus the total deterministic gzip byte count.

- [ ] **Step 3: Run the frontend benchmark against production servers**

Run in one shell:

```bash
devbox run -- bash -lc '
set -euo pipefail
cd backend
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/inventorymgr-perf-api.log 2>&1 & api_pid=$!
cd ../frontend
bun run start --hostname 127.0.0.1 --port 3000 > /tmp/inventorymgr-perf-web.log 2>&1 & web_pid=$!
trap "kill $api_pid $web_pid" EXIT
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8000/api/health >/dev/null && curl -fsS http://127.0.0.1:3000/login >/dev/null && break; sleep 1; done
PERF_OUTPUT=../docs/superpowers/refactor/phase-5-performance/raw/frontend-performance.json BASE_URL=http://127.0.0.1:3000 bunx playwright test e2e/performance.spec.ts --project=chromium --workers=1
'
```

Expected: PASS and the output contains 15 samples for each route. Stop if another process was already serving either port.

- [ ] **Step 4: Validate frontend sample completeness**

Run:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path('docs/superpowers/refactor/phase-5-performance/raw/frontend-performance.json')
data = json.loads(p.read_text())
assert set(data['routes']) == {'/dashboard', '/reports', '/inventory'}
for route, result in data['routes'].items():
    assert len(result['durations_ms']) == 15, route
    assert len(result['transfer_bytes']) == 15, route
    assert all(value > 0 for value in result['durations_ms']), route
    assert all(value > 0 for value in result['transfer_bytes']), route
print('frontend performance samples valid')
PY
```

Expected: prints `frontend performance samples valid`.

- [ ] **Step 5: Commit the frontend harness**

Run:

```bash
git add -f frontend/e2e/performance.spec.ts
git diff --cached --check
git commit -m "test: add frontend performance harness"
```

Expected: only the ignored E2E test is committed.

---

### Task 4: Normalize and validate the replacement baseline

**Files:**
- Create: `tools/summarize-performance.py`
- Create: `docs/superpowers/refactor/phase-5-performance/baseline.json`
- Modify: `docs/superpowers/refactor/phase-5-performance/README.md`

**Interfaces:**
- Consumes: the backend, frontend route, and frontend bundle raw JSON files.
- Produces: one committed baseline with medians, coefficient of variation, fixture/sample metadata, and source commit.

- [ ] **Step 1: Write the strict summarizer**

Create `tools/summarize-performance.py` with CLI forms:

```text
python3 tools/summarize-performance.py baseline --backend PATH --frontend PATH --bundle PATH --output PATH
python3 tools/summarize-performance.py compare --baseline PATH --candidate PATH
```

For every timing series calculate `statistics.median(values)` and `statistics.stdev(values) / statistics.mean(values)`. `baseline` must fail if a backend series is not length 30, a frontend series is not length 15, metadata differs from Task 1, or any timing coefficient of variation exceeds `0.05`. `compare` must print percentage changes and exit nonzero for a timing improvement below 10% when timing is the claimed benefit, a timing regression of at least 5%, any query-count increase, or any bundle/transfer-byte increase.

- [ ] **Step 2: Generate the first candidate baseline**

Run:

```bash
python3 tools/summarize-performance.py baseline \
  --backend docs/superpowers/refactor/phase-5-performance/raw/backend-performance.json \
  --frontend docs/superpowers/refactor/phase-5-performance/raw/frontend-performance.json \
  --bundle docs/superpowers/refactor/phase-5-performance/raw/frontend-bundle.json \
  --output docs/superpowers/refactor/phase-5-performance/baseline.json
```

Expected: succeeds only when all timing series have coefficient of variation at most 5%.

- [ ] **Step 3: Repeat the complete measurements to prove repeatability**

Run Tasks 2 Step 3 and 3 Steps 2–3 again with output filenames ending in `-repeat.json`, then run:

```bash
python3 tools/summarize-performance.py baseline \
  --backend docs/superpowers/refactor/phase-5-performance/raw/backend-performance-repeat.json \
  --frontend docs/superpowers/refactor/phase-5-performance/raw/frontend-performance-repeat.json \
  --bundle docs/superpowers/refactor/phase-5-performance/raw/frontend-bundle-repeat.json \
  --output /tmp/inventorymgr-performance-repeat.json
python3 tools/summarize-performance.py compare \
  --baseline docs/superpowers/refactor/phase-5-performance/baseline.json \
  --candidate /tmp/inventorymgr-performance-repeat.json
```

Expected: no query-count or byte changes and no timing difference of 5% or more. If this fails, do not select timing candidates; control the environment and retry once, then reject unstable timing measures.

- [ ] **Step 4: Document the replacement baseline**

Append to the phase README exact tables for backend median duration/query count, frontend median duration/transfer bytes, bundle gzip bytes, all coefficients of variation, both source commit hashes, and this statement:

```markdown
This committed baseline supersedes the invalid Phase 1 backend duration attempt. Frontend coverage remains a known quality-gate blocker and was not reclassified as performance evidence.
```

- [ ] **Step 5: Commit the baseline tooling and record**

Run:

```bash
git add -f tools/summarize-performance.py docs/superpowers/refactor/phase-5-performance/README.md docs/superpowers/refactor/phase-5-performance/baseline.json
git diff --cached --check
git commit -m "test: establish replacement performance baseline"
```

Expected: summarizer and concise baseline evidence are committed; raw samples remain local unless explicitly requested for review.

---

### Task 5: Select the highest-ranked candidate without pre-authorizing code changes

**Files:**
- Modify: `docs/superpowers/refactor/phase-5-performance/README.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`
- Create conditionally: `docs/superpowers/plans/2026-08-12-performance-candidate-perf-001.md`

**Interfaces:**
- Consumes: replacement baseline, application profiling/query evidence, and fixed acceptance rules.
- Produces: rejected decisions for unsupported items and one separately approved bounded implementation plan for the highest-ranked qualifying item.

- [ ] **Step 1: Capture mechanism evidence for expensive measurements**

Run:

```bash
graphify query "dashboard reports summary and VM list SQL query construction call paths" > docs/superpowers/refactor/phase-5-performance/raw/backend-candidate-paths.txt
graphify query "dashboard reports and inventory frontend route imports render paths and bundle boundaries" > docs/superpowers/refactor/phase-5-performance/raw/frontend-candidate-paths.txt
```

Expected: exact call/import paths are available to explain a measured cost. A high median alone does not prove a changeable bottleneck.

- [ ] **Step 2: Apply the selection rules**

For every measured path, add a README decision row with measured values:

```markdown
| Candidate ID | Baseline cost | Mechanism evidence | Deterministic target | Decision |
|---|---:|---|---:|---|
```

Rank paths by deterministic query/byte waste first and repeatable median timing second. Select at most the single highest-ranked path that has a demonstrated query/import/render mechanism and either a deterministic query/byte target or a credible timing target of at least 10%. Mark unsupported paths `rejected` or `ambiguous`; defer additional qualifying paths to later separately planned phases so this rollback boundary stays bounded.

- [ ] **Step 3: Stop cleanly when nothing qualifies**

If no row qualifies, update any Phase 5 performance ledger rows to `rejected` with the baseline evidence path, then run:

```bash
git add -f docs/superpowers/refactor/phase-5-performance/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git diff --cached --check
git commit -m "docs: reject unsupported performance changes"
```

Expected: documentation-only commit succeeds. Skip Tasks 5 Step 4 and Task 6 and report that Phase 5 made no production change.

- [ ] **Step 4: Write one bounded plan per qualifying candidate**

For the single selected path, assign ID `PERF-001` and create `docs/superpowers/plans/2026-08-12-performance-candidate-perf-001.md` using the writing-plans header. The plan must name the exact production files identified by the profile, include a failing characterization/performance comparison before implementation, preserve the affected contracts, use the same baseline fixture, require `summarize-performance.py compare`, include focused and stack gates, specify a single rollback commit, and contain the candidate's numeric query/byte target or 10% timing target. Do not use generic production paths or unresolved tokens.

- [ ] **Step 5: Validate and submit candidate plans for approval**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
path = Path('docs/superpowers/plans/2026-08-12-performance-candidate-perf-001.md')
text = path.read_text()
for token in ['T' + 'BD', 'TO' + 'DO', 'fill' + ' in']:
    assert token not in text, (path, token)
assert '10%' in text or 'query' in text or 'bytes' in text
print('validated PERF-001 candidate plan')
PY
git add -f docs/superpowers/plans/2026-08-12-performance-candidate-perf-001.md docs/superpowers/refactor/phase-5-performance/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git diff --cached --check
git commit -m "docs: select measured performance candidates"
```

Expected: candidate-specific plans and decision evidence are committed. Stop and request approval; this phase plan itself does not authorize production edits.

---

### Task 6: Execute and verify approved bounded candidates

**Files:**
- Modify: only files named by an approved `2026-08-12-performance-candidate-perf-001.md`.
- Test: only characterization/benchmark files named by that candidate plan.
- Modify: `docs/superpowers/refactor/phase-5-performance/README.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`

**Interfaces:**
- Consumes: the approved PERF-001 candidate plan, the committed replacement baseline, and its exact numeric acceptance target.
- Produces: one reversible candidate commit with before/after proof, or a full revert with a rejected ledger decision.

- [ ] **Step 1: Execute the approved PERF-001 candidate plan in isolation**

Run the exact failing characterization test, minimal implementation, focused test, and comparison commands written in the approved candidate plan. Do not start a second candidate in the same working tree.

- [ ] **Step 2: Enforce the performance comparison**

Run:

```bash
python3 tools/summarize-performance.py compare \
  --baseline docs/superpowers/refactor/phase-5-performance/baseline.json \
  --candidate docs/superpowers/refactor/phase-5-performance/candidate.json
```

Expected: exit 0, with the selected deterministic metric reduced or timing improved by at least 10%, no query-count or byte increase, and no repeatable timing regression of 5% or more.

- [ ] **Step 3: Revert a failed candidate completely**

If Step 2 or any candidate-plan test fails, run:

```bash
git revert --no-edit HEAD
git status --short
```

Expected: a revert commit restores the pre-candidate production tree and the tracked working tree is clean. Record the candidate as `rejected` with the failed metric; do not tune thresholds or retain partial production edits.

- [ ] **Step 4: Run the applicable stack gate for a passing candidate**

For a backend candidate, run:

```bash
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest'
```

For a frontend candidate, run:

```bash
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck && bun run test && bunx playwright test'
```

Expected: every command passes. The known missing backend test-support files or frontend 80% coverage failure must not be silently waived; if they prevent the gate, stop and record the blocker rather than declaring the candidate complete.

- [ ] **Step 5: Record and commit the candidate result**

Update the README with before/after values and the ledger status to `resolved` only after Steps 2 and 4 pass, then run:

```bash
git add -f docs/superpowers/refactor/phase-5-performance/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git diff --cached --check
git commit -m "docs: record measured performance result"
```

Expected: the result names the candidate commit and exact metrics.

---

### Task 7: Close the performance phase

**Files:**
- Modify: `docs/superpowers/refactor/phase-5-performance/README.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`

**Interfaces:**
- Consumes: all candidate decisions and comparisons.
- Produces: final Phase 5 status and a graph index reflecting committed files.

- [ ] **Step 1: Verify no selected candidate lacks a terminal decision**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('docs/superpowers/refactor/phase-5-performance/README.md').read_text()
assert '| selected |' not in text.lower(), 'selected candidate lacks resolved/rejected result'
assert 'Frontend coverage remains a known quality-gate blocker' in text
print('performance decisions are terminal')
PY
```

Expected: prints `performance decisions are terminal`.

- [ ] **Step 2: Update graphify without forcing a destructive rebuild**

Run:

```bash
graphify update .
```

Expected: update succeeds. If Graphify again refuses because node counts shrink, record the exact failure and stop; do not use `--force` without a separate repository-index decision.

- [ ] **Step 3: Review and stage only intended phase records**

Run:

```bash
git status --short
git diff --check
git add -f docs/superpowers/refactor/phase-5-performance/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git diff --cached --name-only
```

Expected: staged paths are limited to the two phase records. Raw logs and pre-existing untracked files are not staged.

- [ ] **Step 4: Commit and stop**

Run:

```bash
git commit -m "docs: close measured performance phase"
```

Expected: the commit succeeds. Report replacement baseline paths, selected/rejected candidate IDs, exact before/after metrics, coverage blocker status, and Graphify status; do not begin repository closeout until unresolved blockers have their own approved remediation.
