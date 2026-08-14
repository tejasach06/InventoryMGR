# Dependency Security Audit & Upgrade — Design Spec

Date: 2026-08-14
Status: Approved for implementation planning

## Objective

Audit InventoryMGR's full dependency surface (backend Python, frontend JS,
tooling/CI, base images/runtimes) for known vulnerabilities and staleness,
then upgrade to preferred stable versions — runtimes/base images to n-1 of
latest LTS/stable line, libraries case-by-case by breaking-change risk,
defaulting to latest stable — to keep the project secure and stable without
introducing unreviewed breaking changes.

## Scope

In scope:
- Backend: `backend/pyproject.toml`, `backend/uv.lock`
- Frontend: `frontend/package.json`, `frontend/bun.lock`
- Tooling/CI: `devbox.json` (python/nodejs/uv/just versions), any CI workflow
  pinned tool versions, Playwright/pytest versions
- Base images/runtimes: `backend/Dockerfile` (`python:3.12-slim-bookworm`),
  `frontend/Dockerfile` (`oven/bun:latest`), Node 22, Postgres 16
  (docker-compose service image)

Out of scope:
- Adding permanent new scanning infrastructure (Renovate/Dependabot) — a
  one-time `osv-scanner` cross-check is used during audit only, not wired
  into CI unless it surfaces gaps `uv audit`/`bun audit` miss
- Unrelated refactors not required by an upgrade-induced breakage
- Any change to `ACCEPTED_RISKS.md` risk *entries* beyond what a version
  bump mechanically invalidates (e.g. its grep-based checks)

## Branch & workflow

- Single branch `chore/deps-upgrade`, cut from `dev`.
- Phased commits (see Execution Phases), each independently revertable.
- Gate before PR: `just verify` (ruff, pytest, bun lint, bun typecheck,
  vitest, playwright) and `just audit` (bun audit, uv audit, tools/check-
  accepted-risks.sh) both green.
- Single PR from `chore/deps-upgrade` into `dev`. Normal `dev` → `main`
  merge/deploy flow afterward, unchanged.

## Audit phase (runs first, before any version bump)

1. Baseline: run `just audit` on current `dev`, record findings verbatim.
2. Cross-check: run `osv-scanner` once against `backend/uv.lock` (and
   `frontend/bun.lock` if it supports the lockfile format) as a second
   opinion beside `uv audit`/`bun audit`. One-time run for this audit;
   not added to `justfile` unless it finds a real gap the existing tools
   miss — if redundant, note that and drop it.
3. Diff against `ACCEPTED_RISKS.md`: anything newly flagged that is not
   an existing accepted-risk entry is a required-fix item in this upgrade,
   not a new accepted-risk entry. Accepted-risks stays reserved for
   permanent deliberate tradeoffs, not "not yet upgraded."
4. Produce a current → target version table (filled in as part of
   implementation, not pre-decided here) covering every package in scope,
   with one-line rationale for any major-version jump.

## Version policy

- **Runtimes/base images**: target n-1 of the current latest LTS/stable
  line — Python (currently 3.12), Node (currently 22), Postgres (currently
  16). Re-check what "latest" is at implementation time; if current pin
  is already n-1 or newer, no change needed there.
- **Libraries**: default to latest stable. Each major-version jump gets
  evaluated individually for breaking-change risk before deciding
  latest-vs-hold; decision + reason recorded in the version table.
- **Known pre-existing issue to resolve regardless of policy**: frontend
  currently pins `next@16.2.11` with `react@18.2.0`/`react-dom@18.2.0`.
  Next.js 16 requires React 19. This mismatch predates this audit and
  MUST be resolved (React 19 bump) as part of this work, independent of
  the case-by-case major-version policy.

## Execution phases (commits on `chore/deps-upgrade`)

1. **Runtimes & base images** — `devbox.json`, `backend/Dockerfile`,
   `frontend/Dockerfile`, docker-compose Postgres image tag, CI pinned
   versions if any. Verify: containers build, `just up`/`just up-local`
   boot, `just verify` passes.
2. **Backend libraries** — `uv lock --upgrade` scoped to decided targets,
   resolve deprecations/breaking API changes (e.g. SQLAlchemy, Pydantic,
   FastAPI majors), re-run `uv run ruff check`, `just api-test`, `mypy`.
3. **Frontend libraries** — bump via `bun`, including the React 19 fix,
   Next.js/TanStack Query/Tailwind/Zod/TypeScript/ESLint/Vitest/Playwright
   targets per the version table, resolve breaking changes, re-run
   `bun run lint`, `bun run typecheck`, `bun run test`.
4. **Final gate** — full `just verify` (includes Playwright E2E) and
   `just audit` on the branch; confirm audit findings from step 1 of the
   Audit phase are resolved or already covered by an accepted-risk entry.

## Breaking-change handling

Breakages surfaced by any bump (deprecated APIs, changed signatures,
config format changes) are fixed as part of this work, scoped to what's
needed to make the upgraded version function correctly — not broader
refactors. If a bump turns out to require a disproportionately large
rewrite discovered mid-implementation, stop and re-scope with the user
rather than silently expanding or silently skipping it.

## Rollback

Each phase is its own commit(s) on `chore/deps-upgrade`; a regression
found in phase N can be `git revert`ed without discarding earlier
phases. Nothing is merged into `dev` until all phases pass the final
gate as one PR.

## Testing / verification

- Backend: `just api-test` (pytest against real Postgres test DB)
- Frontend: `just web-test` (vitest, 80% coverage floor preserved)
- Lint/typecheck: `cd backend && uv run ruff check app tests`;
  `cd frontend && bun run lint && bun run typecheck`
- E2E: `just e2e` (Playwright)
- Security: `just audit` (bun audit, uv audit, accepted-risks check) +
  one-time `osv-scanner` cross-check
- Full gate: `just verify`

## Deliverable

This spec → `writing-plans` skill produces a phased implementation plan →
implementation delegated to `prime-agent` CLI (per user's stated
execution preference), with the usual verify-gate discipline before
merging `chore/deps-upgrade` into `dev`.
