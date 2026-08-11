# Refactor Program Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the evidence-gated refactoring program only after every ledger decision, quality/security gate, performance comparison, documentation contract, and repository index is verified.

**Architecture:** Closeout is a verification-and-documentation phase, not a cleanup catch-all. It builds a traceable resolution matrix from the Phase 1 ledger and later phase evidence, runs gates independently so failures remain attributable, updates documentation only after proof exists, and stops without a completion claim whenever a regression or confirmed finding remains unresolved.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pytest, Ruff, Next.js, React, TypeScript, Bun, Vitest, Playwright, Devbox, Just, Graphify, Git, Markdown.

## Global Constraints

- Prerequisite: complete `2026-08-12-graphify-index-recovery.md`; Graphify must represent the current tracked tree before closeout verification.
- Preserve every current user-visible behavior, public API contract, persisted-data contract, RBAC boundary, CSRF rule, audit-log behavior, health-score behavior, CSV round-trip, URL-driven state, and accessibility-critical interaction.
- Closeout must not implement a feature, refactor, dependency upgrade, coverage fix, performance optimization, or unrelated cleanup.
- Run all project commands inside Devbox with `devbox run -- ...` from the repository root.
- `just verify` and `just audit` must both pass at the closeout commit; a pre-existing label does not waive either gate.
- Backend and frontend performance must be no worse than the accepted replacement baseline: no query-count or bundle/transfer-byte increase and no repeatable timing regression of 5% or more.
- Every confirmed ledger finding must be `resolved` or explicitly retained with evidence and rationale; `suspected` and `ambiguous` entries may remain only with a current, explicit retention decision.
- Stop on any unresolved regression, missing evidence, failed migration, failed gate, stale documentation contract, or failed Graphify update.
- Do not use `graphify update . --force` to bypass the Phase 1 node-count refusal without a separately approved index-rebuild decision.
- Do not delete, rewrite, or stage pre-existing untracked files.
- `docs/`, `backend/tests/`, `frontend/src/test/`, `frontend/e2e/`, `justfile`, and `tools/` are ignored on the deploy-aligned branch; use `git add -f` for intentional closeout changes in those paths.
- Stage only the named closeout records and documentation corrections proved by this plan.
- Use `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md` as the completion source of truth.

---

## File Structure

- Create: `docs/superpowers/refactor/closeout/verification.md` — immutable command/evidence matrix for quality, security, migration, performance, documentation, and Graphify gates.
- Create: `docs/superpowers/refactor/closeout/retained-exceptions.md` — explicit rationale and future trigger for every intentionally retained suspected or ambiguous finding; the file states `None` when there are no retained exceptions.
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md` — terminal statuses and evidence links only.
- Modify if evidence proves drift: `README.md` — developer-facing commands and application architecture.
- Modify if evidence proves drift: `docs/RUNBOOK.md` — deployment, migration, recovery, and operational commands.
- Modify if evidence proves drift: `AGENTS.md` — repository architecture, command, and invariant guidance.
- Modify if evidence proves drift: `DESIGN.md` and `PRODUCT.md` — resulting UI/product contracts without cosmetic redesign.
- Modify if evidence proves drift: relevant `docs/superpowers/specs/*.md` or completed phase README files — historical status notes only; do not rewrite accepted design history.
- Modify: no production or test source files. A source/test failure stops closeout and requires a separate bounded remediation plan.

---

### Task 1: Freeze the closeout scope and resolution matrix

**Files:**
- Create: `docs/superpowers/refactor/closeout/verification.md`
- Create: `docs/superpowers/refactor/closeout/retained-exceptions.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`

**Interfaces:**
- Consumes: Phase 1 README/ledger, all later phase plans and evidence READMEs, and current Git history.
- Produces: one row per ledger finding with terminal evidence or an explicit blocker.

- [ ] **Step 1: Confirm a clean tracked starting point**

Run:

```bash
devbox run -- bash -lc 'git status --short --branch; git log --oneline --decorate -20'
```

Expected: no unrelated tracked modifications. Pre-existing untracked files remain untouched.

- [ ] **Step 2: Inventory every refactor artifact and ledger row**

Run:

```bash
find docs/superpowers/refactor docs/superpowers/plans docs/superpowers/specs -type f -print | sort
python3 - <<'PY'
from pathlib import Path
p = Path('docs/superpowers/refactor/phase-1-baseline/ledger.md')
rows = [line for line in p.read_text().splitlines() if line.startswith('| REF-')]
assert rows, 'ledger has no findings'
for row in rows:
    print(row)
print(f'ledger rows: {len(rows)}')
PY
```

Expected: all phase evidence paths and every `REF-` row are visible. Do not infer resolution from a commit title alone.

- [ ] **Step 3: Create the verification record skeleton**

Create `docs/superpowers/refactor/closeout/verification.md` with:

```markdown
# Refactor Program Closeout Verification

## Scope

Closeout commit: recorded after final commit
Design source: `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md`

## Ledger Resolution

| ID | Pre-closeout status | Terminal decision | Evidence | Verification command |
|---|---|---|---|---|

## Quality and Security Gates

| Gate | Commit | Exit status | Evidence summary |
|---|---|---:|---|

## Migration Gate

| Check | Exit status | Evidence summary |
|---|---:|---|

## Performance Gate

| Metric | Accepted baseline | Closeout result | Change | Decision |
|---|---:|---:|---:|---|

## Documentation Consistency

| Contract | Authoritative files | Result |
|---|---|---|

## Graphify

Command: `graphify update .`
Result: not run
```

Expected: headings and table schemas exist; actual rows are added only from later task evidence.

- [ ] **Step 4: Create the retained-exception register**

Create `docs/superpowers/refactor/closeout/retained-exceptions.md` with:

```markdown
# Retained Refactor Exceptions

No exception is accepted solely because it was difficult to verify. Each retained item must name its ledger ID, current evidence, preservation rationale, risk, and the concrete event that triggers re-evaluation.

| ID | Status | Current evidence | Retention rationale | Risk | Re-evaluation trigger |
|---|---|---|---|---|---|
```

Expected: the table is empty until Task 2 proves an exception is retained.

- [ ] **Step 5: Commit the closeout workspace**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md docs/superpowers/refactor/closeout/retained-exceptions.md
git diff --cached --check
git commit -m "docs: add refactor closeout workspace"
```

Expected: documentation-only commit succeeds.

---

### Task 2: Resolve or retain every ledger finding

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`
- Modify: `docs/superpowers/refactor/closeout/verification.md`
- Modify: `docs/superpowers/refactor/closeout/retained-exceptions.md`

**Interfaces:**
- Consumes: commits, tests, measurements, and phase records for each ledger ID.
- Produces: no `confirmed` finding without resolution and no retained item without rationale.

- [ ] **Step 1: Check every claimed resolution against tracked evidence**

For each ledger row, run:

```bash
git log --all --oneline -- docs/superpowers/refactor backend/app frontend/src tools justfile
git grep -n 'REF-[0-9][0-9][0-9]' -- docs/superpowers
```

Expected: each `resolved` row can cite a phase record, focused verification command, and commit. If evidence is absent, restore its prior non-terminal status and stop closeout.

- [ ] **Step 2: Apply fixed terminal-decision rules**

Update ledger rows only as follows:

```text
resolved  = approved change or evidence decision completed, focused gate passed, phase gate passed, and commit recorded
rejected  = evidence disproved the finding or proved it out of scope; rejection rationale recorded
ambiguous = usage or boundary evidence remains insufficient; retained-exception row required
suspected = evidence remains incomplete; retained-exception row required and program cannot claim every candidate investigated
confirmed = prohibited at closeout; resolve it or stop
```

Expected: status meanings remain identical to the design spec.

- [ ] **Step 3: Populate the retained-exception register**

For every remaining `suspected` or `ambiguous` row, add one exact row to `retained-exceptions.md` naming its current evidence, why preservation is safer, affected invariant, risk, and a testable re-evaluation trigger such as a dependency entrypoint removal or a new failing profile. If none remain, add:

```markdown
| None | None | All findings have terminal evidence. | No retained exception. | None | Re-open only when new evidence creates a ledger finding. |
```

Expected: every non-terminal ledger status maps to exactly one exception row.

- [ ] **Step 4: Validate ledger and exception coverage**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
ledger = Path('docs/superpowers/refactor/phase-1-baseline/ledger.md').read_text().splitlines()
exceptions = Path('docs/superpowers/refactor/closeout/retained-exceptions.md').read_text()
valid = {'suspected', 'confirmed', 'ambiguous', 'rejected', 'resolved'}
errors = []
for row in (line for line in ledger if line.startswith('| REF-')):
    cols = [c.strip() for c in row.strip('|').split('|')]
    ident, status = cols[0], cols[-1]
    if status not in valid:
        errors.append(f'{ident}: invalid status {status}')
    if status == 'confirmed':
        errors.append(f'{ident}: confirmed finding blocks closeout')
    if status in {'suspected', 'ambiguous'} and ident not in exceptions:
        errors.append(f'{ident}: missing retained exception')
if errors:
    raise SystemExit('\n'.join(errors))
print('ledger decisions and retained exceptions validated')
PY
```

Expected: prints `ledger decisions and retained exceptions validated`; otherwise stop.

- [ ] **Step 5: Record ledger decisions in verification.md**

Copy one concise row per ledger ID into `## Ledger Resolution`, including status, phase evidence path, commit hash, and exact focused verification command. Do not use a generic “tests passed” statement.

- [ ] **Step 6: Commit the resolution matrix**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/ledger.md docs/superpowers/refactor/closeout/verification.md docs/superpowers/refactor/closeout/retained-exceptions.md
git diff --cached --check
git commit -m "docs: reconcile refactor ledger"
```

Expected: documentation-only commit succeeds.

---

### Task 3: Verify clean-schema migration and backend invariants

**Files:**
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: current Alembic history, backend application, and backend test suite.
- Produces: clean-schema and backend gate evidence tied to the current commit.

- [ ] **Step 1: Reset only the dedicated test schema**

Run:

```bash
devbox run -- just db-up
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run python - <<"PY"
import os
from sqlalchemy import create_engine, text
engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as connection:
    connection.execute(text("DROP SCHEMA public CASCADE"))
    connection.execute(text("CREATE SCHEMA public"))
engine.dispose()
PY'
```

Expected: only `inventorymgr_test` public schema is recreated. Stop if `TEST_DATABASE_URL` is unset or points anywhere other than the dedicated test database.

- [ ] **Step 2: Upgrade a clean schema to head**

Run:

```bash
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic current'
```

Expected: Alembic upgrade succeeds and `current` reports head.

- [ ] **Step 3: Run backend lint and the complete backend suite**

Run:

```bash
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest'
```

Expected: Ruff and all collected backend tests pass. The Phase 1 import errors (`tests.conftest` missing/relative import failure) are not waivable; if they recur, stop and create a bounded test-infrastructure remediation plan.

- [ ] **Step 4: Verify the required invariant coverage is collected**

Run:

```bash
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest --collect-only -q' > /tmp/inventorymgr-backend-collect.txt
python3 - <<'PY'
from pathlib import Path
text = Path('/tmp/inventorymgr-backend-collect.txt').read_text().lower()
required = ['csrf', 'rbac', 'audit', 'health', 'csv', 'storage', 'cluster']
missing = [term for term in required if term not in text]
if missing:
    raise SystemExit('backend invariant coverage not collected: ' + ', '.join(missing))
print('backend invariant coverage collected')
PY
```

Expected: prints `backend invariant coverage collected`. Missing characterization is a blocker, not permission to add tests during closeout.

- [ ] **Step 5: Record migration and backend results**

Add the current commit, exact Alembic head, collected/passed test counts, Ruff result, and invariant-collection result to `verification.md`.

- [ ] **Step 6: Commit backend verification evidence**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md
git diff --cached --check
git commit -m "docs: record backend closeout gate"
```

Expected: documentation-only commit succeeds.

---

### Task 4: Verify frontend coverage, behavior, and production build

**Files:**
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: current frontend source, Vitest configuration, Playwright suite, and Next production build.
- Produces: passing 80% coverage and complete frontend behavior evidence.

- [ ] **Step 1: Run lint and typecheck**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run lint && bun run typecheck'
```

Expected: both commands pass.

- [ ] **Step 2: Run unit tests with the configured coverage gate**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bun run test -- --coverage'
```

Expected: all tests pass and lines, statements, functions, and branches are each at least 80%. The Phase 1 percentages below 80% are an unresolved blocker unless a separately approved test plan has already corrected them; do not lower or exclude coverage here.

- [ ] **Step 3: Run the full Playwright suite**

Run:

```bash
devbox run -- bash -lc 'cd frontend && bunx playwright test --workers=1'
```

Expected: all E2E tests pass, including authentication, inventory URL state, storage/cluster relationships, CSV workflows, and accessibility-critical interactions represented by the suite.

- [ ] **Step 4: Run a clean production build**

Run:

```bash
devbox run -- bash -lc 'cd frontend && rm -rf .next && bun run build'
```

Expected: Next.js production build succeeds for every route.

- [ ] **Step 5: Record frontend results**

Add the current commit, test counts, four coverage percentages, Playwright counts, lint/typecheck results, and production-build route count to `verification.md`.

- [ ] **Step 6: Commit frontend verification evidence**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md
git diff --cached --check
git commit -m "docs: record frontend closeout gate"
```

Expected: documentation-only commit succeeds.

---

### Task 5: Run the authoritative full quality and security gates

**Files:**
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: repository `justfile`, accepted-risk register, lockfiles, and all application tests.
- Produces: authoritative `just verify` and `just audit` results on the same commit lineage.

- [ ] **Step 1: Run the full verification recipe**

Run:

```bash
devbox run -- just verify
```

Expected: Ruff, backend Pytest, frontend lint/typecheck/Vitest, and Playwright all pass. Stop immediately on failure.

- [ ] **Step 2: Run the full audit recipe**

Run:

```bash
devbox run -- just audit
```

Expected: Bun audit, uv audit, typecheck, Ruff, and accepted-risk check all pass. The Phase 1 `bun audit` result of 21 advisories (10 high, 11 moderate) blocks closeout unless already resolved or represented by a valid accepted-risk mechanism that makes the current recipe pass; do not change dependencies during closeout.

- [ ] **Step 3: Record exact gate evidence**

Add the current commit, exit status 0, test counts, and audit summary to `verification.md`. Do not write PASS before both commands actually exit 0.

- [ ] **Step 4: Commit authoritative gate evidence**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md
git diff --cached --check
git commit -m "docs: record full refactor gates"
```

Expected: documentation-only commit succeeds.

---

### Task 6: Prove performance is no worse than baseline

**Files:**
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: `docs/superpowers/refactor/phase-5-performance/baseline.json`, committed benchmark harnesses, and `tools/summarize-performance.py`.
- Produces: a closeout candidate JSON and accepted comparison table.

- [ ] **Step 1: Confirm the accepted replacement baseline exists**

Run:

```bash
test -f docs/superpowers/refactor/phase-5-performance/baseline.json
test -f tools/summarize-performance.py
test -f backend/tests/performance/test_endpoint_performance.py
test -f frontend/e2e/performance.spec.ts
```

Expected: all four files exist. If Phase 5 legitimately selected no optimizations, its replacement baseline still must exist for no-regression proof.

- [ ] **Step 2: Re-run backend and frontend benchmark commands**

Run the exact backend, production-build, bundle-gzip, and production Playwright commands recorded in `docs/superpowers/refactor/phase-5-performance/README.md`, writing normalized output to:

```text
docs/superpowers/refactor/closeout/performance-candidate.json
```

Expected: fixture counts, sample counts, environment, and output schema exactly match the accepted baseline.

- [ ] **Step 3: Compare closeout results with the accepted baseline**

Run:

```bash
python3 tools/summarize-performance.py compare \
  --baseline docs/superpowers/refactor/phase-5-performance/baseline.json \
  --candidate docs/superpowers/refactor/closeout/performance-candidate.json
```

Expected: exit 0; no query-count, bundle-byte, or transfer-byte increase and no repeatable timing regression of 5% or more. Repeat once under the same controlled conditions if timing variance exceeds 5%; if the regression repeats, stop closeout.

- [ ] **Step 4: Record exact performance comparison**

Populate `## Performance Gate` with every baseline/result value, percentage change, variance, and decision. Raw samples remain local; the normalized candidate may be committed because it is concise evidence.

- [ ] **Step 5: Commit performance closeout evidence**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md docs/superpowers/refactor/closeout/performance-candidate.json
git diff --cached --check
git commit -m "docs: record performance closeout gate"
```

Expected: concise evidence-only commit succeeds.

---

### Task 7: Reconcile architecture and operational documentation

**Files:**
- Modify if drift exists: `README.md`
- Modify if drift exists: `docs/RUNBOOK.md`
- Modify if drift exists: `AGENTS.md`
- Modify if drift exists: `DESIGN.md`
- Modify if drift exists: `PRODUCT.md`
- Modify if drift exists: relevant completed phase README/spec files
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: resulting routes, services, schemas, package scripts, Just recipes, deployment files, and accepted design contracts.
- Produces: documentation matching the final repository without rewriting historical decisions.

- [ ] **Step 1: Map current architecture and commands**

Run:

```bash
graphify query "current InventoryMGR backend routes services schemas invariants and frontend route API architecture" > /tmp/inventorymgr-closeout-architecture.txt
graphify query "current InventoryMGR development test audit deployment migration and recovery commands" > /tmp/inventorymgr-closeout-commands.txt
git grep -nE 'just (verify|audit|api-test|web-test|e2e)|alembic upgrade head|inventorymgr_session|inventorymgr_csrf|health_score|CSV' -- README.md docs/RUNBOOK.md AGENTS.md DESIGN.md PRODUCT.md docs/superpowers/specs
```

Expected: current code paths and documented contracts can be compared directly.

- [ ] **Step 2: Verify critical contract consistency**

Check and record each exact contract in `verification.md`:

```text
Authentication cookie: inventorymgr_session
CSRF cookie/header: inventorymgr_csrf / X-CSRF-Token
RBAC order: viewer < editor < admin
VM/child mutation invariant: recompute health
VM field mutation invariant: audit log old/new values
CSV child schemas: disks, role-scoped IPs, applications
Frontend requests: central typed API client
List state: URL searchParams
Final commands: just verify and just audit
Migration command: cd backend && uv run alembic upgrade head
```

Expected: README, RUNBOOK, AGENTS, DESIGN, PRODUCT, and relevant specs do not contradict the current implementation.

- [ ] **Step 3: Correct only proven documentation drift**

Edit only statements contradicted by current tracked code or commands. Preserve historical design text; append an implementation-status note rather than rewriting the original decision. Do not make source changes to force documentation to become true.

- [ ] **Step 4: Validate documented commands and paths**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
required = [
    Path('README.md'), Path('docs/RUNBOOK.md'), Path('AGENTS.md'),
    Path('DESIGN.md'), Path('PRODUCT.md'), Path('justfile'),
]
missing = [str(path) for path in required if not path.exists()]
if missing:
    raise SystemExit('missing documented file: ' + ', '.join(missing))
just = Path('justfile').read_text()
for recipe in ['verify:', 'audit:', 'api-test:', 'web-test:', 'e2e:']:
    assert recipe in just, recipe
print('documented files and recipes exist')
PY
git diff --check -- README.md docs/RUNBOOK.md AGENTS.md DESIGN.md PRODUCT.md docs/superpowers
```

Expected: paths/recipes exist and documentation diff has no whitespace errors.

- [ ] **Step 5: Record documentation decisions**

Populate `## Documentation Consistency` with one row for architecture, security invariants, data invariants, frontend state/API patterns, development commands, migrations, and operations. Each row names inspected authoritative files and PASS.

- [ ] **Step 6: Commit documentation reconciliation**

Run:

```bash
git add -f README.md docs/RUNBOOK.md AGENTS.md DESIGN.md PRODUCT.md docs/superpowers/refactor/closeout/verification.md
git diff --cached --check
git commit -m "docs: reconcile refactor architecture"
```

Expected: only proven documentation corrections and the verification record are committed. If no docs drift exists, stage and commit only `verification.md`.

---

### Task 8: Update Graphify and perform the final stop gate

**Files:**
- Modify: `docs/superpowers/refactor/closeout/verification.md`

**Interfaces:**
- Consumes: final tracked repository and all closeout evidence.
- Produces: final completion decision with no unresolved regression.

- [ ] **Step 1: Update the repository graph**

Run:

```bash
graphify update .
```

Expected: Graphify completes successfully. The Phase 1 refusal caused by a 4403-node rebuild versus an existing 4878-node graph is unresolved until this command exits successfully; do not force overwrite.

- [ ] **Step 2: Record Graphify result and final commit candidate**

Replace `Result: not run` in `verification.md` with the actual successful output summary and record `git rev-parse HEAD` as the verified source commit.

- [ ] **Step 3: Run a machine-readable completion check**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
ledger = Path('docs/superpowers/refactor/phase-1-baseline/ledger.md').read_text()
verification = Path('docs/superpowers/refactor/closeout/verification.md').read_text()
assert '| confirmed |' not in ledger.lower(), 'confirmed ledger finding remains'
for phrase in [
    'just verify', 'just audit', 'Performance Gate', 'Documentation Consistency',
    'graphify update .',
]:
    assert phrase in verification, phrase
for blocker in ['Result: not run', 'FAIL', 'BLOCKED', 'unresolved regression']:
    assert blocker not in verification, blocker
print('closeout completion record validated')
PY
```

Expected: prints `closeout completion record validated`. Any assertion failure stops completion.

- [ ] **Step 4: Re-run final authoritative gates after documentation commits**

Run:

```bash
devbox run -- just verify
devbox run -- just audit
python3 tools/summarize-performance.py compare \
  --baseline docs/superpowers/refactor/phase-5-performance/baseline.json \
  --candidate docs/superpowers/refactor/closeout/performance-candidate.json
```

Expected: all three commands exit 0 on the final source/documentation tree. Stop on any failure.

- [ ] **Step 5: Stage ignored closeout files explicitly and inspect the index**

Run:

```bash
git add -f docs/superpowers/refactor/closeout/verification.md docs/superpowers/refactor/closeout/retained-exceptions.md docs/superpowers/refactor/closeout/performance-candidate.json docs/superpowers/refactor/phase-1-baseline/ledger.md
git diff --cached --check
git diff --cached --name-status
git status --short
```

Expected: only intended closeout documentation/evidence is staged; no raw logs, caches, test results, or pre-existing untracked files are staged.

- [ ] **Step 6: Commit the closeout record**

Run:

```bash
git commit -m "docs: close evidence-gated refactor program"
```

Expected: commit succeeds.

- [ ] **Step 7: Verify the committed tree and stop**

Run:

```bash
git status --short --branch
git show --stat --oneline HEAD
```

Expected: no tracked changes remain. Report the closeout commit, `just verify` and `just audit` PASS, performance comparison PASS, ledger counts by status, retained exceptions, documentation files changed, and Graphify PASS. If any expected condition is absent, report the blocker and do not state that the refactor program is complete.
