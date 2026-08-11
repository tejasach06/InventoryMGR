# Evidence-Gated Refactor Program Plan Index

> **For agentic workers:** Execute only one linked implementation plan at a time. Do not start the next plan until the current plan's final gate passes and its commit is reviewed.

**Goal:** Define the complete execution order for the approved evidence-gated refactoring program before any post-audit implementation begins.

**Architecture:** The program advances through independently reversible plans. A failed gate stops the sequence; later plans may be revised from measured evidence, but no later phase may absorb unrelated work.

## Global Constraints

- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Characterization coverage precedes structural production-code changes.
- No speculative deletion or optimization is authorized.
- Each linked plan owns its file scope, verification commands, commits, and stop conditions.
- The complete plan set is committed before executing the first post-audit plan.

## Execution Order

1. **Phase 1 — Baseline audit: complete**
   - Plan: `docs/superpowers/plans/2026-08-11-refactor-baseline-audit.md`
   - Evidence: `docs/superpowers/refactor/phase-1-baseline/`
   - Final commit: `ca52d8f`

2. **Phase 2 — Dead-code cleanup: deferred**
   - Phase 1 produced no confirmed dead-code finding.
   - REF-004 remains `ambiguous`; deleting `.github/skills/impeccable/scripts/*` is not authorized.
   - There is intentionally no deletion implementation plan. If later evidence confirms a candidate, it requires a candidate-specific design and plan before deletion.

3. **Phase 3A — Restore the backend test gate**
   - Plan: `docs/superpowers/plans/2026-08-12-backend-test-harness-restoration.md`
   - Stop unless Ruff passes and all currently tracked backend tests pass.

4. **Phase 3B — Characterize and split CSV import parsing**
   - Plan: `docs/superpowers/plans/2026-08-12-csv-import-service-refactor.md`
   - Requires Phase 3A green.
   - Keeps `app.services.csv_import` as the compatibility facade.

5. **Phase 3C — Characterize and split VM service responsibilities**
   - Plan: `docs/superpowers/plans/2026-08-12-vm-service-refactor.md`
   - Requires Phases 3A and 3B green.
   - Keeps `app.services.vms` as the compatibility facade.

6. **Phase 4 — Inventory page structural refactor**
   - Plan: `docs/superpowers/plans/2026-08-12-inventory-page-structural-refactor.md`
   - Requires backend phases green so cross-stack failures are attributable.
   - Preserves URL, API, bulk-edit, role, accessibility, table, and card behavior.

7. **Phase 5 — Measured performance optimization**
   - Plan: `docs/superpowers/plans/2026-08-12-measured-performance-optimization.md`
   - Establishes replacement baselines and may end without production changes.
   - A candidate-specific implementation plan is created only when stable measurements qualify a concrete candidate; writing one now would be speculative and violate the approved design.

8. **Repository tooling gate — Graphify index recovery**
   - Plan: `docs/superpowers/plans/2026-08-12-graphify-index-recovery.md`
   - Runs after structural changes and before closeout.
   - A forced replacement is authorized only after isolated extraction proves no tracked application source coverage was lost.

9. **Phase 6 — Program closeout**
   - Plan: `docs/superpowers/plans/2026-08-12-refactor-program-closeout.md`
   - Runs only after all approved earlier plans finish or are explicitly retained with evidence.
   - Completion requires quality, security, migration, performance, documentation, ledger, and Graphify gates to pass.

## Review Checkpoints

- Review and approve the full plan set before Phase 3A.
- Review every phase commit before advancing.
- Stop for a new design if any route, schema, migration, UI workflow, accessibility contract, or persisted-data change becomes necessary.
- Stop after Phase 5 measurement when no candidate qualifies.
- Do not claim program completion until the Phase 6 plan passes without waived gates.
