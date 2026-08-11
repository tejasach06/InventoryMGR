# Refactor Baseline Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the Phase 1 baseline and evidence ledger for the evidence-gated InventoryMGR codebase refactoring program without changing production code.

**Architecture:** Phase 1 is documentation and measurement only. It creates one refactor audit directory containing raw-command evidence, a normalized ledger, and a phase summary that later phases use to select safe cleanup and restructuring work.

**Tech Stack:** FastAPI, SQLAlchemy, Pytest, Ruff, Next.js, React, TypeScript, Bun, Vitest, Playwright, Devbox, Just, Graphify, Git.

## Global Constraints

- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Make no production-code changes in this plan.
- Do not delete, stage, or rewrite existing untracked files.
- Run project commands through `devbox run -- <command>` from the repository root.
- Route large or unbounded command output through `ctx_execute` or save it under `docs/superpowers/refactor/phase-1-baseline/raw/`; do not paste full logs into the plan or ledger.
- Treat generated caches, ignored outputs, and currently untracked local files as outside scope.
- Use the spec at `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md` as the source of truth.
- End the phase with a committed documentation-only change and `graphify update .`.
- Because `.gitignore` ignores `docs/` on the deploy-aligned branch, use `git add -f` for every new file under `docs/superpowers/refactor/phase-1-baseline/`.

---

## File Structure

- Create: `docs/superpowers/refactor/phase-1-baseline/README.md` — phase summary, environment, command status, and next-step recommendation.
- Create: `docs/superpowers/refactor/phase-1-baseline/ledger.md` — normalized finding ledger with status values from the spec.
- Create: `docs/superpowers/refactor/phase-1-baseline/raw/.gitkeep` — keeps the raw-evidence directory present without committing bulky logs.
- Create optional ignored/local files under `docs/superpowers/refactor/phase-1-baseline/raw/` while working — command logs, benchmark JSON/text, and analysis scratch files. Commit only concise evidence summaries unless a log is small and useful.
- Modify: no backend, frontend, deployment, or test source files.

---

### Task 1: Create the Phase 1 evidence workspace

**Files:**
- Create: `docs/superpowers/refactor/phase-1-baseline/README.md`
- Create: `docs/superpowers/refactor/phase-1-baseline/ledger.md`
- Create: `docs/superpowers/refactor/phase-1-baseline/raw/.gitkeep`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-11-evidence-gated-codebase-refactoring-design.md`
- Produces: Empty but valid Phase 1 documentation files that later tasks append to.

- [ ] **Step 1: Confirm clean tracked state before audit docs**

Run:

```bash
git status --short --branch
```

Expected: branch is `dev`; existing untracked local files may be present. Do not stage or modify those pre-existing untracked files.

- [ ] **Step 2: Create directories and starter files**

Run:

```bash
mkdir -p docs/superpowers/refactor/phase-1-baseline/raw
cat > docs/superpowers/refactor/phase-1-baseline/raw/.gitkeep <<'EOF'
EOF
cat > docs/superpowers/refactor/phase-1-baseline/README.md <<'EOF'
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
| pending | pending | pending |

## Summary

No findings have been recorded yet.
EOF
cat > docs/superpowers/refactor/phase-1-baseline/ledger.md <<'EOF'
# Phase 1 Refactoring Ledger

Status values: `suspected`, `confirmed`, `ambiguous`, `rejected`, `resolved`.

| ID | Subsystem | Location | Category | Evidence | Affected invariants | Recommended action | Risk | Verification | Target phase | Status |
|---|---|---|---|---|---|---|---|---|---|---|
EOF
```

- [ ] **Step 3: Verify docs render as plain Markdown**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
for path in [
    Path('docs/superpowers/refactor/phase-1-baseline/README.md'),
    Path('docs/superpowers/refactor/phase-1-baseline/ledger.md'),
]:
    text = path.read_text()
    assert 'pending' in text or 'Status values' in text
    forbidden = ['T' + 'BD', 'TO' + 'DO']
    assert all(token not in text for token in forbidden)
print('phase-1 docs initialized')
PY
```

Expected: prints `phase-1 docs initialized`.

- [ ] **Step 4: Commit the workspace skeleton**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md docs/superpowers/refactor/phase-1-baseline/raw/.gitkeep
git commit -m "docs: add refactor audit workspace"
```

Expected: documentation-only commit succeeds.

---

### Task 2: Capture baseline quality-gate evidence

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/README.md`

**Interfaces:**
- Consumes: workspace from Task 1.
- Produces: command status table with current quality-gate evidence.

- [ ] **Step 1: Run backend lint and save output**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd backend && uv run ruff check app tests"' > docs/superpowers/refactor/phase-1-baseline/raw/backend-ruff.txt
```

Expected: raw summary saved. If `ctx_execute` is unavailable, run the quoted `devbox run -- bash -lc ...` command and redirect stdout/stderr to the same file.

- [ ] **Step 2: Run backend tests and save output**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest"' > docs/superpowers/refactor/phase-1-baseline/raw/backend-pytest.txt
```

Expected: raw summary saved. If the database is unavailable, run `devbox run -- just db-up`, retry once, and record both attempts.

- [ ] **Step 3: Run frontend lint/typecheck and save output**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd frontend && bun run lint && bun run typecheck"' > docs/superpowers/refactor/phase-1-baseline/raw/frontend-lint-typecheck.txt
```

Expected: raw summary saved.

- [ ] **Step 4: Run frontend unit tests and save output**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd frontend && bun run test"' > docs/superpowers/refactor/phase-1-baseline/raw/frontend-vitest.txt
```

Expected: raw summary saved.

- [ ] **Step 5: Run dependency and accepted-risk checks and save output**

Run:

```bash
ctx_execute 'devbox run -- just audit' > docs/superpowers/refactor/phase-1-baseline/raw/audit.txt
```

Expected: raw summary saved. Pre-existing failures are recorded; do not fix them in Phase 1.

- [ ] **Step 6: Update the README command table**

Replace the pending table in `docs/superpowers/refactor/phase-1-baseline/README.md` with rows for:

```markdown
| Command | Status | Evidence |
|---|---:|---|
| `cd backend && uv run ruff check app tests` | use actual command status | `raw/backend-ruff.txt` |
| `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest` | use actual command status | `raw/backend-pytest.txt` |
| `cd frontend && bun run lint && bun run typecheck` | use actual command status | `raw/frontend-lint-typecheck.txt` |
| `cd frontend && bun run test` | use actual command status | `raw/frontend-vitest.txt` |
| `just audit` | use actual command status | `raw/audit.txt` |
```

Use the actual status from each command. If a command fails for an environmental reason, write `FAIL (environment)` and one sentence below the table explaining the observed environment problem.

- [ ] **Step 7: Commit quality baseline docs**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/README.md
git commit -m "docs: record refactor quality baseline"
```

Expected: documentation-only commit succeeds. Do not commit large raw logs unless they are intentionally small and reviewable.

---

### Task 3: Capture static structure and dead-code evidence

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/README.md`

**Interfaces:**
- Consumes: baseline workspace and command table.
- Produces: confirmed/suspected/ambiguous ledger entries for cleanup and restructuring candidates.

- [ ] **Step 1: Generate tracked file-size inventory**

Run:

```bash
python3 - <<'PY' > docs/superpowers/refactor/phase-1-baseline/raw/tracked-file-lines.tsv
from pathlib import Path
import subprocess
root = Path('.')
paths = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
rows = []
for rel in paths:
    path = root / rel
    if path.is_file() and not any(part in {'.git', 'node_modules'} for part in path.parts):
        try:
            lines = sum(1 for _ in path.open(errors='ignore'))
        except OSError:
            continue
        rows.append((lines, rel))
for lines, rel in sorted(rows, reverse=True):
    print(f'{lines}	{rel}')
PY
```

Expected: TSV sorted by line count.

- [ ] **Step 2: Run graphify structure queries**

Run:

```bash
graphify query "InventoryMGR backend oversized responsibilities and refactor boundaries" > docs/superpowers/refactor/phase-1-baseline/raw/graphify-backend-structure.txt
graphify query "InventoryMGR frontend route component duplication and refactor boundaries" > docs/superpowers/refactor/phase-1-baseline/raw/graphify-frontend-structure.txt
graphify query "InventoryMGR tracked files or symbols that appear unreferenced obsolete or dead code" > docs/superpowers/refactor/phase-1-baseline/raw/graphify-dead-code.txt
```

Expected: three concise graphify outputs saved.

- [ ] **Step 3: Run TypeScript unused-export check through compiler diagnostics**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd frontend && bun run typecheck"' > docs/superpowers/refactor/phase-1-baseline/raw/frontend-unused-diagnostics.txt
```

Expected: TypeScript diagnostics saved. Record only actual unused diagnostics; absence of diagnostics is evidence against deletion, not proof of use.

- [ ] **Step 4: Run Python static import/lint evidence**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd backend && uv run ruff check app tests --select F401,F841,F821"' > docs/superpowers/refactor/phase-1-baseline/raw/backend-unused-diagnostics.txt
```

Expected: Ruff diagnostics saved.

- [ ] **Step 5: Add initial ledger rows from evidence**

Edit `docs/superpowers/refactor/phase-1-baseline/ledger.md` and add rows using this exact shape:

```markdown
| REF-001 | Backend | `backend/app/services/vms.py` | oversized responsibility | File-size inventory plus graphify backend map identify VM CRUD, audit, filters, clone, health recompute adjacency in one service module. | RBAC, CSRF route calls, audit logs, health score, VM list filters | Later phase should split only after characterization coverage identifies stable service boundaries. | High | Scoped pytest for VM CRUD, filters, audit, and health recompute before and after extraction. | 3 | suspected |
| REF-002 | Backend | `backend/app/services/csv_import.py` | oversized responsibility | File-size inventory plus CSV round-trip tests identify parsing, preview diffing, duplicate matching, and commit behavior in one module. | CSV import/export round-trip, additive child records, duplicate detection | Later phase should separate pure parsing/normalization from database commit behavior if tests prove boundaries. | High | `backend/tests/test_csv_imports.py` plus export/import characterization tests. | 3 | suspected |
| REF-003 | Frontend | `frontend/src/routes/InventoryPage.tsx` | oversized responsibility | File-size inventory identifies a large route shell handling URL state, table rendering, filters, selection, bulk edit, and API calls. | URL search params, filtering, sorting, pagination, bulk edit | Later phase should extract URL/list state and table subcomponents while preserving route behavior. | Medium | InventoryPage Vitest coverage plus Playwright list workflows. | 4 | suspected |
```

Add more rows only when the raw evidence supports them. Mark uncertain findings `ambiguous`, not `confirmed`.

- [ ] **Step 6: Summarize structure findings in README**

Append this section to `README.md` and fill counts from the ledger:

```markdown
## Structure Findings

- Suspected findings: N
- Confirmed findings: N
- Ambiguous findings: N
- Rejected findings: N

The highest-risk suspected findings are backend VM service boundaries, CSV import boundaries, and InventoryPage route boundaries. No production-code change is authorized by Phase 1 alone.
```

Replace each `N` with the actual count. Do not leave `N` in the committed file.

- [ ] **Step 7: Commit structure evidence docs**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git commit -m "docs: record refactor structure evidence"
```

Expected: documentation-only commit succeeds.

---

### Task 4: Capture performance baseline evidence

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/README.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`

**Interfaces:**
- Consumes: Phase 1 ledger.
- Produces: repeatable baseline commands and performance-candidate ledger rows.

- [ ] **Step 1: Capture frontend production bundle baseline**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd frontend && bun run build"' > docs/superpowers/refactor/phase-1-baseline/raw/frontend-build.txt
```

Expected: production build output saved. If the build is too slow or fails due to environment, record status and failure reason without changing code.

- [ ] **Step 2: Capture frontend test coverage baseline**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd frontend && bun run test -- --coverage"' > docs/superpowers/refactor/phase-1-baseline/raw/frontend-coverage.txt
```

Expected: coverage output saved or failure recorded.

- [ ] **Step 3: Capture backend endpoint timing baseline with existing tests only**

Run:

```bash
ctx_execute 'devbox run -- bash -lc "cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_dashboard.py tests/test_reports.py tests/test_vm_filters.py -q --durations=20"' > docs/superpowers/refactor/phase-1-baseline/raw/backend-durations.txt
```

Expected: pytest duration output saved. If any named test file does not exist, rerun with the existing subset and record the missing file.

- [ ] **Step 4: Add performance section to README**

Append this section with actual PASS/FAIL statuses and the relevant evidence file paths:

```markdown
## Performance Baseline

| Area | Command | Status | Evidence |
|---|---|---:|---|
| Frontend bundle | `cd frontend && bun run build` | use actual command status | `raw/frontend-build.txt` |
| Frontend coverage | `cd frontend && bun run test -- --coverage` | use actual command status | `raw/frontend-coverage.txt` |
| Backend endpoint durations | `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_dashboard.py tests/test_reports.py tests/test_vm_filters.py -q --durations=20` | use actual command status | `raw/backend-durations.txt` |

Later performance phases must compare against these commands or document a stricter replacement baseline before optimizing.
```

Use actual statuses: `PASS`, `FAIL`, or `FAIL (environment)`.

- [ ] **Step 5: Add performance candidates only if evidence supports them**

If the duration or build output shows an obvious candidate, add a ledger row like:

```markdown
| REF-010 | Frontend | `frontend/src/routes/InventoryPage.tsx` | performance candidate | Build/test output and route size suggest this page should be measured before any extraction. | Inventory list render, URL state, bulk selection | Later phase should measure render and bundle impact before changing code. | Medium | Compare production build output and InventoryPage-focused tests before and after extraction. | 5 | suspected |
```

If no candidate is evident, add this note below the ledger table:

```markdown
No performance candidates are confirmed by Phase 1 baseline alone; later optimization requires stricter before/after measurement.
```

- [ ] **Step 6: Commit performance baseline docs**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git commit -m "docs: record refactor performance baseline"
```

Expected: documentation-only commit succeeds.

---

### Task 5: Finalize the Phase 1 audit package

**Files:**
- Modify: `docs/superpowers/refactor/phase-1-baseline/README.md`
- Modify: `docs/superpowers/refactor/phase-1-baseline/ledger.md`

**Interfaces:**
- Consumes: all Phase 1 evidence from prior tasks.
- Produces: final reviewed Phase 1 audit package and next-phase recommendation.

- [ ] **Step 1: Self-review for forbidden placeholders**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
bad = ['T' + 'BD', 'TO' + 'DO', 'FIX' + 'ME', 'PASS' + ' or ' + 'FAIL', '| pending | pending | pending |', ' N' + chr(10)]
paths = [
    Path('docs/superpowers/refactor/phase-1-baseline/README.md'),
    Path('docs/superpowers/refactor/phase-1-baseline/ledger.md'),
]
failures = []
for path in paths:
    text = path.read_text()
    for token in bad:
        if token in text:
            failures.append(f'{path}: contains {token!r}')
if failures:
    raise SystemExit('
'.join(failures))
print('phase-1 docs have no forbidden placeholders')
PY
```

Expected: prints `phase-1 docs have no forbidden placeholders`. Fix any listed placeholder before continuing.

- [ ] **Step 2: Self-review ledger status values**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
valid = {'suspected', 'confirmed', 'ambiguous', 'rejected', 'resolved'}
path = Path('docs/superpowers/refactor/phase-1-baseline/ledger.md')
rows = [line for line in path.read_text().splitlines() if line.startswith('| REF-')]
for row in rows:
    cols = [c.strip() for c in row.strip('|').split('|')]
    status = cols[-1]
    if status not in valid:
        raise SystemExit(f'invalid status {status!r} in row: {row}')
print(f'validated {len(rows)} ledger rows')
PY
```

Expected: prints `validated X ledger rows` with X equal to the number of findings.

- [ ] **Step 3: Add next-phase recommendation**

Append this section to `README.md` using the actual ledger evidence:

```markdown
## Recommended Next Phase

Recommended next phase: Phase 2 if any `confirmed` dead-code rows exist; otherwise Phase 3 if backend restructuring rows have the strongest evidence; otherwise Phase 4 if frontend restructuring rows have the strongest evidence.

Rationale: cite the two or three strongest ledger rows by ID and explain why they are safer or higher value than alternatives.

Phase 1 does not authorize production-code changes. A separate implementation plan is required before Phase 2, Phase 3, Phase 4, or Phase 5 begins.
```

Replace the rationale sentence with actual row IDs and reasoning. Do not leave generic instruction text in the committed file.

- [ ] **Step 4: Run focused documentation diff review**

Run:

```bash
git diff -- docs/superpowers/refactor/phase-1-baseline/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
```

Expected: diff shows documentation-only evidence and no source-code changes.

- [ ] **Step 5: Update graphify index**

Run:

```bash
graphify update .
```

Expected: graphify update completes. If it launches a background rebuild, wait for or inspect the reported log before claiming completion.

- [ ] **Step 6: Commit final audit package**

Run:

```bash
git add -f docs/superpowers/refactor/phase-1-baseline/README.md docs/superpowers/refactor/phase-1-baseline/ledger.md
git commit -m "docs: finalize refactor baseline audit"
```

Expected: documentation-only commit succeeds.

- [ ] **Step 7: Report completion and stop**

Reply with:

```text
Phase 1 baseline audit is complete. The audit package is in docs/superpowers/refactor/phase-1-baseline/. No production code was changed. Recommended next phase: <Phase N and reason from README>.
```

Do not begin cleanup, restructuring, or optimization until the user approves the recommended next phase and a new implementation plan is written.
