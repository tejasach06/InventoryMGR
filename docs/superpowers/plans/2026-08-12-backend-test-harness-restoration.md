# Backend Test Harness Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the missing backend pytest package marker and shared fixtures so the two current tracked backend test modules collect and pass against PostgreSQL.

**Architecture:** Recover only `backend/tests/__init__.py` and `backend/tests/conftest.py` from the last commit before tests were untracked (`90a99e4^`). This repairs relative and package-qualified fixture imports without changing application code or reviving stale behavior tests.

**Tech Stack:** Python 3.12, pytest, FastAPI TestClient, SQLAlchemy 2.0, PostgreSQL 16, Devbox, uv

## Global Constraints

- This plan is the first gate; do not begin either service-refactor plan until its final Ruff and pytest commands pass.
- Preserve every current user-visible behavior, public API contract, and persisted-data contract.
- Make no production-code, route, schema, migration, frontend, dependency, or configuration changes.
- Do not restore the 25 historical behavior-test modules removed by `90a99e4`; they contain contracts superseded by current production behavior.
- Run every project command through Devbox from `/home/tejas/project/InventoryMGR`.
- `backend/tests/` and `docs/` are ignored by `.gitignore`; stage test files with `git add -f`.
- Do not delete, stage, or rewrite unrelated untracked files.

---

### Task 1: Restore the pytest package and shared fixtures

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_accent_preference.py`
- Test: `backend/tests/test_ldap_auth.py`

**Interfaces:**
- Consumes: current imports `from .conftest import auth_headers, create_user, login` and `from tests.conftest import auth_headers, create_user, login`.
- Produces: fixtures `reset_database()`, `db_session()`, and `client()`; helpers `create_user(db: Session, *, email: str, password: str = "correct horse battery staple", role: UserRole = UserRole.viewer, is_active: bool = True) -> User`, `login(client: TestClient, email: str, password: str = "correct horse battery staple") -> str`, `auth_headers(csrf: str) -> dict[str, str]`, `vm_payload(**overrides: Any) -> dict[str, Any]`, and `create_vm_row(db: Session, user: User, **overrides: Any) -> Vm`.

- [ ] **Step 1: Confirm the current collection failure before restoration**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_accent_preference.py tests/test_ldap_auth.py -q'
```

Expected: collection stops with `ImportError: attempted relative import with no known parent package` for `test_accent_preference.py` and `ModuleNotFoundError: No module named 'tests.conftest'` for `test_ldap_auth.py`.

- [ ] **Step 2: Restore only the package marker and fixture harness from the last tracked version**

Run:

```bash
cd /home/tejas/project/InventoryMGR
mkdir -p backend/tests
git show 90a99e4^:backend/tests/__init__.py > backend/tests/__init__.py
git show 90a99e4^:backend/tests/conftest.py > backend/tests/conftest.py
```

Expected: `backend/tests/__init__.py` is empty, while `backend/tests/conftest.py` configures the PostgreSQL test engine, resets `Base.metadata` around each test, overrides both database dependencies, and exposes the six fixture/helper interfaces listed above.

- [ ] **Step 3: Verify the restored harness against the current tracked tests**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_accent_preference.py tests/test_ldap_auth.py -q'
```

Expected: `11 passed`; deprecation warnings from Starlette/ldap3 are allowed, but no collection error or test failure is allowed.

- [ ] **Step 4: Run the focused backend quality gate**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q'
```

Expected: Ruff reports `All checks passed!` and pytest reports `11 passed`.

- [ ] **Step 5: Commit the independently reversible harness restoration**

```bash
cd /home/tejas/project/InventoryMGR
git add -f backend/tests/__init__.py backend/tests/conftest.py
git diff --cached --check
git commit -m "test: restore backend pytest harness"
```

Expected: the commit contains exactly the two restored harness files and no application code.
