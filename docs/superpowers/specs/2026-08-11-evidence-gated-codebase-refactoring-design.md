# Evidence-Gated Codebase Refactoring Program — Design

## Context

InventoryMGR is a documentation-focused infrastructure inventory with a FastAPI/SQLAlchemy backend and a Next.js/React frontend. Its correctness depends on cross-cutting contracts including stateless CSRF validation, RBAC, VM audit logging, health-score recomputation, CSV import/export round-tripping, and URL-driven frontend state.

The repository contains several large structural hotspots, tracked diagnostic and operational tooling, and potential cleanup candidates. A repository-wide rewrite would make regressions difficult to isolate. This program therefore treats cleanup, restructuring, and optimization as separate, evidence-gated phases.

The recent frontend API-client domain split is complete and is the existing pattern for small, behavior-preserving structural changes.

## Goals

- Remove tracked dead code and obsolete files only when non-use is demonstrated.
- Give oversized or duplicated responsibilities clearer, independently testable boundaries.
- Improve backend and frontend performance only where repeatable measurements justify a change.
- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Deliver independently reviewable and reversible phases, each with its own verification gate.

## Non-goals

- Product features or intentional behavior changes.
- API, route, schema, UI workflow, or persisted-data redesigns.
- Cosmetic redesign or unrelated formatting churn.
- Speculative abstractions or micro-optimizations.
- Changes to generated, ignored, or currently untracked local files.
- Database schema changes unless separately designed and approved with migration and rollback handling.

## Program Architecture

The work is divided into six phases:

1. **Baseline and evidence audit**
   - Record current quality-gate, performance, bundle, and dependency results.
   - Produce a ranked ledger of suspected dead code, duplication, oversized responsibilities, structural problems, and performance candidates.
   - Make no production-code changes.

2. **Proven dead-code cleanup**
   - Remove only tracked code or files supported by strong non-use evidence.
   - Retain ambiguous items and document why.
   - Update affected tests and documentation without changing behavior.

3. **Backend restructuring**
   - Refactor one bounded hotspot at a time.
   - Preserve routes, schemas, database behavior, RBAC, CSRF, audit logging, and health-score invariants.
   - Initial audit candidates include `backend/app/services/vms.py`, `backend/app/services/csv_import.py`, and `backend/app/db/models.py`; file length alone does not authorize a change.

4. **Frontend restructuring**
   - Extract bounded responsibilities from oversized routes and shared UI.
   - Preserve URLs, API calls, visible behavior, accessibility, and query-state behavior.
   - Initial audit candidates include `frontend/src/routes/InventoryPage.tsx` and `frontend/src/routes/VmDetailPage.tsx`.

5. **Measured performance optimization**
   - Benchmark backend queries and API paths plus frontend bundles and render paths.
   - Implement only changes supported by before/after measurements.

6. **Repository consistency closeout**
   - Re-run complete quality, security, dependency, and performance gates.
   - Update architecture and operational documentation.
   - Record intentionally retained exceptions.

Each phase receives its own implementation plan, commits, verification record, and rollback boundary. The first implementation plan covers Phase 1, the baseline and evidence audit, only. Audit findings determine the exact scope of later phase specs and plans.

## Phase 1 Deliverable: Refactoring Ledger

The audit produces one structured ledger. Each finding records:

- Location and responsible subsystem
- Category: dead code, duplication, oversized responsibility, dependency/tooling issue, or performance candidate
- Evidence supporting the finding
- Behavior and invariants potentially affected
- Recommended action
- Risk level and verification requirements
- Target phase
- Status: suspected, confirmed, ambiguous, rejected, or resolved

Status meanings are fixed: `suspected` awaits evidence, `confirmed` is authorized for a later phase, `ambiguous` is retained pending stronger evidence, `rejected` is disproven or out of scope, and `resolved` has completed its verification gate.

The audit covers:

1. Backend application and tests
2. Frontend application, unit tests, and end-to-end tests
3. Tooling and tracked diagnostic scripts
4. Deployment and configuration files
5. Documentation consistency
6. Backend query and API benchmarks
7. Frontend bundle and render benchmarks

Generated caches, ignored outputs, and currently untracked local files are outside scope.

## Evidence Standards

### Dead code

A candidate must have no tracked imports, calls, route registration, script entry, deployment reference, or documented operational use. Static analysis alone is insufficient when dynamic loading is possible.

### Duplication

A finding must identify repeated behavior or structure with a clear shared responsibility. Similar appearance or coincidental syntax is not sufficient.

### Restructuring

A module must contain separable responsibilities with stable interfaces. File length alone does not justify extraction.

### Performance

A repeatable baseline must demonstrate meaningful cost. No optimization is accepted solely because it is theoretically faster.

### Dependencies

Removal requires evidence that source, tests, builds, deployment definitions, and operational scripts do not use the package.

## Refactoring Workflow for Later Phases

1. **Select findings** — choose only related, confirmed ledger items and define preserved contracts and measurable acceptance conditions.
2. **Capture baseline** — run relevant tests, add characterization coverage where required, and capture performance measurements for optimization findings.
3. **Apply the narrowest change** — delete, extract, consolidate, or optimize one bounded responsibility while keeping public interfaces stable.
4. **Run focused verification** — test the affected unit, route, component, or workflow and check applicable cross-cutting invariants.
5. **Run the phase gate** — run backend or frontend quality gates; cross-stack and final phases run the complete gates.
6. **Record results** — update ledger evidence and status, record before/after results, document retained ambiguity, and commit an independently reversible phase.

A phase must not absorb unrelated findings merely because they are nearby. A necessary cross-subsystem change becomes an explicit, bounded integration phase.

## Safety, Failure Handling, and Rollback

- If the baseline quality gate fails, record the failure and classify it as environmental or pre-existing before refactoring.
- If usage evidence is ambiguous, retain the candidate and mark it `ambiguous`.
- If characterization reveals undocumented behavior, preserve it unless a separate behavior-change proposal is approved.
- If a structural change requires altering an API, route, schema, UI workflow, or persisted-data contract, stop and create a separate proposal.
- If performance measurements vary materially, repeat them under controlled conditions or reject the candidate.
- If a phase fails its quality gate, repair or revert that phase before continuing.
- Do not delete, stage, or rewrite existing untracked files.

Each phase is independently committed so it can be reverted without unwinding unrelated work. Hotspot work must be split further when one change cannot be safely reviewed or reverted.

## Testing and Verification

Every affected phase must preserve coverage for:

- Authentication, session refresh, CSRF, and RBAC boundaries
- VM audit-log creation and health-score recomputation
- CSV import/export round-trip behavior
- Storage and cluster relationships
- URL-driven frontend search, filtering, sorting, and pagination
- API-client retry and error handling
- Accessibility-critical interactions and keyboard behavior
- Database migration from a clean schema
- Deployment and operational command validity

Characterization tests are added before restructuring whenever existing tests do not prove a preserved contract.

Phase gates use the repository's established commands:

- Backend changes: Ruff and relevant pytest suites, plus migration/schema checks where applicable
- Frontend changes: ESLint, TypeScript, Vitest, and relevant Playwright flows
- Cross-stack and final phases: `just verify` and `just audit`

All project commands run inside `devbox shell`.

## Performance Measurement

Before and after measurements run in the same controlled environment:

- Backend: query counts and median endpoint duration over repeated runs
- Frontend: production bundle output and targeted render measurements

A performance result is accepted only when it reduces a deterministic measure, such as query count or transferred/bundled bytes, or yields a repeatable timing improvement of at least 10%. Increased query counts or bundle bytes block the phase unless an explicit contract-preserving trade-off is approved. A repeatable timing regression of 5% or more also blocks the phase.

The Phase 1 audit records the exact benchmark command, environment, fixture data, sample count, and result format so later measurements are comparable.

## Completion Criteria

The program is complete when:

- Every confirmed audit finding is resolved or explicitly retained with rationale.
- No deletion relies solely on filename, age, or static-analysis suspicion.
- Public behavior and contracts remain unchanged.
- Full `just verify` and `just audit` pass.
- Backend and frontend performance results are no worse than baseline.
- Addressed structural hotspots have clearer single-purpose boundaries without speculative abstractions.
- Architecture and operational documentation match the resulting repository.
