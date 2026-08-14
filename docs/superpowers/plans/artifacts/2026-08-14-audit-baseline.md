# Dependency Security Upgrade Audit Baseline

Captured 2026-08-14 on `chore/deps-upgrade` from `dev`.

## Baseline just audit

```text
=== Frontend (bun audit) ===
cd frontend && bun audit
[0m[1mbun audit [0m[2mv1.3.14 (0d9b296a)[0m
[32mNo vulnerabilities found[0m
=== Backend (uv audit) ===
cd backend && uv audit
warning: `uv audit` is experimental and may change without warning. Pass `--preview-features audit` to disable this warning.
Resolved 62 packages in 1ms
Found no known vulnerabilities and no adverse project statuses in 61 packages
=== TypeScript typecheck ===
cd frontend && bun run typecheck
[0m[2m[35m$[0m [2m[1mtsc --noEmit[0m
=== Python lint (ruff) ===
cd backend && uv run ruff check app tests
[1;32mAll checks passed![0m
=== Accepted risks check ===
bash tools/check-accepted-risks.sh
--- Checking accepted risks ---
  [PASS] RISK-001: 0.0.0.0 bind present in backend Dockerfile and frontend start script (expected)
--- All accepted risks are current ---

```

## osv-scanner cross-check

`osv-scanner` was not installed and Homebrew is unavailable in this environment. The prescribed fallback was attempted; no cross-check output could be produced. `just audit` reported no known vulnerabilities in either lockfile.

## Required fixes (not accepted risks)

No findings were reported by `just audit`; therefore there are no unmatched vulnerability findings. The required compatibility fix is React 18 → 19 (mandated by the supplied plan), despite no audit finding.

## Outdated package checks

### Backend (`uv pip list --outdated`)

```text
Package           Version   Latest    Type
----------------- --------- --------- -----
alembic           1.18.4    1.19.1    wheel
annotated-doc     0.0.4     0.0.5     wheel
annotated-types   0.7.0     0.8.0     wheel
anyio             4.13.0    4.14.2    wheel
ast-serialize     0.5.0     0.8.0     wheel
certifi           2026.5.20 2026.7.22 wheel
cffi              2.0.0     2.1.1     wheel
click             8.4.1     8.4.2     wheel
fastapi           0.136.3   0.141.1   wheel
greenlet          3.5.1     3.5.5     wheel
librt             0.11.0    0.15.0    wheel
mako              1.3.12    1.4.1     wheel
mypy              2.1.0     2.3.0     wheel
packaging         26.2      26.3      wheel
pwdlib            0.3.0     0.3.1     wheel
pydantic-core     2.46.4    2.48.0    wheel
pydantic-settings 2.14.2    2.15.0    wheel
pytest            9.0.3     9.1.1     wheel
ruff              0.15.17   0.16.3    wheel
sqlalchemy        2.0.50    2.0.52    wheel
starlette         1.3.1     1.6.0     wheel
typing-extensions 4.15.0    4.16.0    wheel
typing-inspection 0.4.2     0.4.4     wheel
uvicorn           0.49.0    0.52.3    wheel
websockets        16.0      17.0.1    wheel
wrapt             2.2.2     2.3.0     wheel

```

### Frontend (`bun outdated`)

```text
[0m[1mbun outdated [0m[2mv1.3.14 (0d9b296a)[0m
  🔍 Resolving... ┌───────────────────────────────────┬─────────┬─────────┬─────────┐
│ [1m[34mPackage[0m                           │ [1m[34mCurrent[0m │ [1m[34mUpdate[0m  │ [1m[34mLatest[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @tanstack/react-query[2m[0m             │ 5.101.0 │ [2m5.101.0[0m │ [2m5.101.[0m[1m[32m4[0m │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ next[2m[0m                              │ 16.2.11 │ [2m16.2.11[0m │ [2m16.[0m[1m[33m3.1[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ react[2m[0m                             │ 18.2.0  │ [2m18.2.0[0m  │ [0m[1m[31m19.2.8[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ react-dom[2m[0m                         │ 18.2.0  │ [2m18.2.0[0m  │ [0m[1m[31m19.2.8[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ typescript[2m[0m                        │ 6.0.3   │ [2m6.0.3[0m   │ [0m[1m[31m7.0.2[0m   │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @playwright/test[2m (dev)[0m            │ 1.60.0  │ [2m1.60.0[0m  │ [2m1.[0m[1m[33m62.1[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @tailwindcss/postcss[2m (dev)[0m        │ 4.3.1   │ [2m4.3.1[0m   │ [2m4.3.[0m[1m[32m3[0m   │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @testing-library/jest-dom[2m (dev)[0m   │ 6.9.1   │ [2m6.9.1[0m   │ [0m[1m[31m7.0.1[0m   │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @testing-library/user-event[2m (dev)[0m │ 14.6.1  │ [2m14.6.1[0m  │ [2m14.6.[0m[1m[32m4[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @types/node[2m (dev)[0m                 │ 25.9.3  │ [2m25.9.3[0m  │ [0m[1m[31m26.2.0[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @types/react[2m (dev)[0m                │ 18.2.44 │ [2m18.2.44[0m │ [0m[1m[31m19.2.18[0m │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @types/react-dom[2m (dev)[0m            │ 18.2.8  │ [2m18.2.8[0m  │ [0m[1m[31m19.2.4[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ @vitest/coverage-v8[2m (dev)[0m         │ 4.1.8   │ [2m4.1.8[0m   │ [2m4.1.[0m[1m[32m10[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ eslint[2m (dev)[0m                      │ 10.8.0  │ [2m10.8.0[0m  │ [2m10.8.[0m[1m[32m1[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ jsdom[2m (dev)[0m                       │ 29.1.1  │ [2m29.1.1[0m  │ [0m[1m[31m30.0.1[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ tailwindcss[2m (dev)[0m                 │ 4.3.1   │ [2m4.3.1[0m   │ [2m4.3.[0m[1m[32m3[0m   │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ typescript-eslint[2m (dev)[0m           │ 8.65.0  │ [2m8.65.0[0m  │ [2m8.[0m[1m[33m67.0[0m  │
├───────────────────────────────────┼─────────┼─────────┼─────────┤
│ vitest[2m (dev)[0m                      │ 4.1.8   │ [2m4.1.8[0m   │ [2m4.1.[0m[1m[32m10[0m  │
└───────────────────────────────────┴─────────┴─────────┴─────────┘

```

## Version target table

Targets use latest stable where available. Runtime policy is n-1 of latest stable/LTS: Python 3.14 latest → 3.13, Node 24 latest LTS → 22 (already current), PostgreSQL 18 latest → 17. React 19 is mandatory because Next 16 requires it. Packages not listed as outdated remain at their current lock-compatible versions.

| Package | Current | Target | Rationale |
|---|---:|---:|---|
| Python runtime/devbox | 3.12 | 3.13 | n-1 of Python 3.14; update project typing targets. |
| Node runtime/devbox | 22 | 22 | Already n-1 of Node 24 LTS. |
| PostgreSQL images | 16 | 17 | n-1 of PostgreSQL 18. |
| Bun image | latest | 1.3.14 | Pin current installed Bun for reproducible builds. |
| backend fastapi | 0.136.3 | 0.141.1 | Latest stable minor. |
| backend uvicorn | 0.49.0 | 0.52.3 | Latest stable minor. |
| backend sqlalchemy | 2.0.50 | 2.0.52 | Latest stable patch. |
| backend alembic | 1.18.4 | 1.19.1 | Latest stable minor. |
| backend psycopg | 3.3.4 | 3.3.4 | No outdated report; retain lock-compatible release. |
| backend pydantic-settings | 2.14.2 | 2.15.0 | Latest stable minor. |
| backend PyJWT | 2.13.0 | 2.13.0 | No outdated report; retain. |
| backend pwdlib | 0.3.0 | 0.3.1 | Latest stable patch. |
| backend python-multipart | 0.0.32 | 0.0.32 | No outdated report; retain. |
| backend email-validator | 2.3.0 | 2.3.0 | No outdated report; retain. |
| backend slowapi | 0.1.10 | 0.1.10 | No newer stable release reported; retain. |
| backend xlsxwriter | 3.2.9 | 3.2.9 | No outdated report; retain. |
| backend ldap3 | 2.9.1 | 2.9.1 | No outdated report; retain. |
| backend cryptography | 50.0.0 | 50.0.0 | No outdated report; retain. |
| backend pytest | 9.0.3 | 9.1.1 | Latest stable minor. |
| backend pytest-asyncio | 1.4.0 | 1.4.0 | No outdated report; retain. |
| backend httpx | 0.28.1 | 0.28.1 | No outdated report; retain. |
| backend ruff | 0.15.17 | 0.16.3 | Latest stable minor. |
| backend mypy | 2.1.0 | 2.3.0 | Latest stable minor. |
| frontend @tanstack/react-query | 5.101.0 | 5.101.4 | Latest stable patch. |
| frontend next | 16.2.11 | 16.3.1 | Latest stable minor; same major. |
| frontend react | 18.2.0 | 19.2.8 | Required Next 16 compatibility; major jump rationale. |
| frontend react-dom | 18.2.0 | 19.2.8 | Must match React 19; major jump rationale. |
| frontend @types/react | 18.2.44 | 19.2.18 | Match React 19 runtime types; major jump rationale. |
| frontend @types/react-dom | 18.2.8 | 19.2.4 | Match React DOM 19 runtime types; major jump rationale. |
| frontend typescript | 6.0.3 | 7.0.2 | Latest stable major; review compiler breakage during verification. |
| frontend zod | 4.4.3 | 4.4.3 | No outdated report; retain. |
| frontend @playwright/test | 1.60.0 | 1.62.1 | Latest stable minor. |
| frontend @tailwindcss/postcss | 4.3.1 | 4.3.3 | Latest stable patch. |
| frontend @testing-library/jest-dom | 6.9.1 | 7.0.1 | Latest stable major; scoped test matcher migration if needed. |
| frontend @testing-library/react | 16.3.2 | 16.3.2 | No outdated report; retain. |
| frontend @testing-library/user-event | 14.6.1 | 14.6.4 | Latest stable patch. |
| frontend @types/node | 25.9.3 | 26.2.0 | Latest stable major aligned with current toolchain. |
| frontend @vitest/coverage-v8 | 4.1.8 | 4.1.10 | Latest stable patch. |
| frontend eslint | 10.8.0 | 10.8.1 | Latest stable patch. |
| frontend eslint-plugin-tailwindcss | 4.2.0 | 4.2.0 | No outdated report; retain. |
| frontend jsdom | 29.1.1 | 30.0.1 | Latest stable major; test-environment breakage fixed if surfaced. |
| frontend postcss | 8.5.23 | 8.5.23 | Override already enforces secure floor. |
| frontend tailwindcss | 4.3.1 | 4.3.3 | Latest stable patch. |
| frontend typescript-eslint | 8.65.0 | 8.67.0 | Latest stable minor. |
| frontend vitest | 4.1.8 | 4.1.10 | Latest stable patch. |
| override nanoid | >=3.3.17 | >=3.3.17 | Existing secure floor; no audit finding. |
| override postcss | >=8.5.23 | >=8.5.23 | Existing secure floor; no audit finding. |
| override sharp | >=0.35.0 | >=0.35.0 | Existing secure floor; no audit finding. |
| override undici | >=7.29.0 <8.0.0 | >=7.29.0 <8.0.0 | Existing secure major-bounded floor; no audit finding. |

## Cross-check conclusion

No incremental findings beyond `just audit`; `osv-scanner` was unavailable and is not added to CI.
