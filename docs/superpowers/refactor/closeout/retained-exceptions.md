# Retained Refactor Exceptions

No exception is accepted solely because it was difficult to verify. Each retained item must name its ledger ID, current evidence, preservation rationale, risk, and the concrete event that triggers re-evaluation.

| ID | Status | Current evidence | Retention rationale | Risk | Re-evaluation trigger |
|---|---|---|---|---|---|
| REF-004 | ambiguous | Phase 1 graphify and file-size evidence surfaced large `.github/skills/impeccable/scripts/*` support scripts, while Ruff and TypeScript unused diagnostics found no application unused-code findings and no tracked code/docs/CI/package command evidence proves safe removal. | Preserve repository/agent support tooling because deletion could break operational design-review workflows not exercised by application gates. | Low: possible support-tool bloat remains; higher risk is accidental removal of dynamically invoked tooling. | Re-evaluate when `.github/skills/impeccable` entrypoints are removed from documented agent workflows, when a dependency/entrypoint audit proves no script-level use, or when a new failing profile identifies a specific unused script. |
