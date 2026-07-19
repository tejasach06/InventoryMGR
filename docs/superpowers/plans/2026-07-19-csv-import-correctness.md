# CSV Import Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the CSV import update path from silently blanking every field the CSV did not mention, and make the preview show what an import will actually change.

**Architecture:** `normalize_csv_row` currently emits every known field regardless of what the CSV supplied, which defeats `exclude_unset=True` in `update_vm`. It changes to emit supplied values only — one rule, "a value is supplied when its cell is non-blank", covering both absent columns and blank cells. Create re-applies `DEFAULTS` on top. Preview classification then compares supplied values against the matched VM to produce a new `unchanged` action and a per-row change map, which aggregates into a batch-level rollup.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Pydantic v2, Alembic, Postgres 16 (JSONB), Next.js App Router, TanStack Query, Vitest, Playwright.

## Global Constraints

- All work runs inside `devbox shell`.
- Backend tests need Postgres up: `just db-up`, then `APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest`.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Every state-changing route must declare `Csrf`. Omit it and CSRF is silently off for that endpoint.
- Any mutation of a VM or its children must leave `health_score` recomputed. `commit_batch` already does this once for all touched VMs after flush — do not add per-row recomputation.
- Vitest enforces 80% coverage on lines/statements/functions/branches.
- Deliberate simplifications carry a `ponytail:` comment naming the ceiling.
- Enums in `db/models.py` are Python `StrEnum`s; changing one needs a migration.
- Alembic head is `0010`. The single new revision in this plan is `0011`.

## Design Corrections Discovered During Planning

The spec said to remove `backup_location` from the frontend template. That is
backwards. `backup_location` is a real `Vm` column (migration `0010`, present
in `VmBase`); `csv_import.OPTIONAL_HEADERS` simply never got updated when
`0010` landed. The template was correct and the backend was stale.

Measured relationship:

```
VmBase fields not in ALL_HEADERS: ['backup_location', 'vm_type']
ALL_HEADERS not VmBase fields:    ['disk_gb', 'disk_name', 'ip_address']
```

`ALL_HEADERS` is a hand-maintained duplicate of `VmBase`. Task 2 derives it
instead, so this class of drift cannot recur. Task 7 serves the template from
the API for the same reason, deleting the frontend's duplicate list rather
than adding a test that it stays in sync.

`vm_type` stays excluded from CSV: `services/vms.py::_apply_vm_type_lifecycle`
derives lifecycle from it, and letting an import drive that is out of scope.

## File Structure

**Backend**
- `app/services/csv_import.py` — all normalization, classification, and commit logic. Tasks 1–5.
- `app/db/models.py` — `ImportAction.unchanged`, three new JSONB columns. Tasks 3–4.
- `app/schemas/imports.py` — expose new fields on read models. Tasks 3–4.
- `app/api/routes/imports.py` — new template endpoint. Task 7.
- `alembic/versions/0011_import_change_tracking.py` — one revision. Task 4.

**Frontend**
- `src/api/client.ts` — `ImportAction` union, `ImportBatch` fields. Task 6.
- `src/routes/ImportCsvPage.tsx` — fifth card, change counts, rollup, ignored warning, template download. Tasks 6–7.

**Tests**
- `backend/tests/test_csv_imports.py` — extends the existing file; it is already the only place touching `/api/imports`.
- `frontend/src/test/ImportCsvPage.test.tsx` — extends existing.

---

### Task 1: Supplied-only normalization

Makes the committed failing test at `f0a6677` pass. This is the data-loss fix; everything else is reporting.

**Files:**
- Modify: `backend/app/services/csv_import.py:99-233`
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `normalize_csv_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, str]]]` — unchanged signature, but the returned dict now contains **only supplied keys**. Every later task depends on this.
- Produces: `_parse_int`, `_parse_bool`, `_parse_date`, `_parse_list` now return `None` when the cell is blank, meaning "absent". Callers omit the key.
- Produces: module constants `STRING_HEADERS`, `ENUM_HEADERS`, `INT_HEADERS`, `BOOL_HEADERS`, `DATE_HEADERS`, `LIST_HEADERS`, `CHILD_HEADERS`. Tasks 2 and 5 consume these.

- [ ] **Step 1: Run the committed regression test to confirm it still fails**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py::test_partial_column_update_preserves_unmentioned_fields -v
```

Expected: FAIL with `AssertionError: assert None == 'existing-app.corp.example'`

- [ ] **Step 2: Add a blank-cell test alongside it**

An absent column and a present-but-blank column must behave identically. The
committed test covers absent; this covers blank.

```python
def test_blank_cell_in_present_column_does_not_overwrite(
    client, db_session: Session
) -> None:
    """Blank cell means "leave alone", exactly like an absent column."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        fqdn="existing-app.corp.example",
        owner="alice",
        cpu_cores=8,
        monitoring_enabled=True,
    )
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,fqdn,cpu_cores,monitoring_enabled",
            "Existing App,proxmox,pve-cluster-a,bob,,,",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    body = response.json()

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    refreshed = db_session.get(Vm, vm_id)
    assert refreshed is not None
    assert refreshed.owner == "bob"
    assert refreshed.fqdn == "existing-app.corp.example"
    assert refreshed.cpu_cores == 8
    assert refreshed.monitoring_enabled is True
```

- [ ] **Step 3: Add a create-still-defaults test**

The blank-means-skip rule must not leak into create, where a new row still
needs values.

```python
def test_create_with_blank_cells_still_applies_defaults(
    client, db_session: Session
) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,status,criticality,cpu_cores,monitoring_enabled",
            "Brand New,proxmox,pve-cluster-a,,,,",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["create"] == 1

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Brand New"))
    assert created is not None
    assert created.status.value == "unknown"
    assert created.criticality.value == "medium"
    assert created.environment.value == "production"
    assert created.cpu_cores == 0
    assert created.monitoring_enabled is False
```

- [ ] **Step 4: Run both new tests to verify they fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -k "blank_cell or blank_cells" -v
```

Expected: `test_blank_cell_in_present_column_does_not_overwrite` FAILS (fqdn is `None`).
`test_create_with_blank_cells_still_applies_defaults` PASSES already — defaults
work on create today. Keep it; it is the guard that Step 6 does not break create.

- [ ] **Step 5: Change the parse helpers to signal absence**

Replace `_parse_int`, `_parse_bool`, `_parse_date`, `_parse_list` in
`app/services/csv_import.py`. Each returns `None` for a blank cell. `None` is
unambiguous here because under the new semantics a blank cell never produces a
stored `None` — absence and null are no longer conflated.

```python
def _parse_int(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> int | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    try:
        value = int(raw)
    except ValueError:
        errors.append(_error(field, "must be an integer >= 0"))
        return None
    if value < 0:
        errors.append(_error(field, "must be an integer >= 0"))
        return None
    return value


def _parse_bool(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> bool | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    lowered = raw.lower()
    if lowered in {"true", "yes", "1"}:
        return True
    if lowered in {"false", "no", "0"}:
        return False
    errors.append(_error(field, "must be one of true, false, yes, no, 1, 0"))
    return None


def _parse_list(row: dict[str, str], field: str) -> list[str] | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    return [part.strip() for part in raw.split(";") if part.strip()]


def _parse_date(row: dict[str, str], field: str, errors: list[dict[str, str]]) -> str | None:
    raw = row.get(field, "")
    if raw == "":
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        errors.append(_error(field, "must be ISO date YYYY-MM-DD"))
        return None
```

- [ ] **Step 6: Rewrite `normalize_csv_row` to emit supplied keys only**

Replace the whole function. Define the typed header groups above it — Task 2
relies on them existing as module constants.

```python
STRING_HEADERS = (
    "external_id",
    "fqdn",
    "description",
    "datacenter",
    "node",
    "sr_id",
    "os_name",
    "os_distribution",
    "os_version",
    "owner",
    "business_owner",
    "technical_owner",
    "security_remarks",
    "backup_location",
)
ENUM_HEADERS = ("status", "environment", "criticality", "lifecycle", "os_family")
INT_HEADERS = ("cpu_cores", "memory_mb")
BOOL_HEADERS = ("monitoring_enabled", "ha_enabled", "backup_enabled", "pmp_enabled")
DATE_HEADERS = (
    "last_patch_date",
    "last_vuln_scan_date",
    "decommission_date",
    "last_verified_at",
)
LIST_HEADERS = ("tags",)
CHILD_HEADERS = {"disk_name", "disk_gb", "ip_address"}


def normalize_csv_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    """Normalize one CSV row into supplied values only.

    A value is supplied when its cell is non-blank. An absent column and a
    blank cell are equivalent and both mean "leave this field alone" — the
    caller decides whether to fall back to DEFAULTS (create) or to omit the
    key entirely (update).
    """
    clean = _clean_row(row)
    errors: list[dict[str, str]] = []
    normalized: dict[str, Any] = {}

    for field in REQUIRED_HEADERS:
        value = clean.get(field, "")
        if value == "":
            errors.append(_error(field, "is required and cannot be blank"))
        normalized[field] = value

    platform_raw = clean.get("platform", "").lower()
    if platform_raw:
        platform = PLATFORM_ALIASES.get(platform_raw)
        if platform is None:
            errors.append(
                _error("platform", "must be one of proxmox, pve, vmware, vsphere, vcenter")
            )
        else:
            normalized["platform"] = platform

    for field in STRING_HEADERS:
        value = clean.get(field, "")
        if value:
            normalized[field] = value

    for field in ENUM_HEADERS:
        value = clean.get(field, "").lower()
        if not value:
            continue
        if value not in ENUM_VALUES[field]:
            errors.append(_error(field, f"must be one of {', '.join(sorted(ENUM_VALUES[field]))}"))
        else:
            normalized[field] = value

    for field in INT_HEADERS:
        value = _parse_int(clean, field, errors)
        if value is not None:
            normalized[field] = value

    for field in BOOL_HEADERS:
        flag = _parse_bool(clean, field, errors)
        if flag is not None:
            normalized[field] = flag

    for field in LIST_HEADERS:
        items = _parse_list(clean, field)
        if items is not None:
            normalized[field] = items

    for field in DATE_HEADERS:
        stamp = _parse_date(clean, field, errors)
        if stamp is not None:
            normalized[field] = stamp

    if errors:
        return None, errors
    return normalized, []
```

- [ ] **Step 7: Apply DEFAULTS on the create branch only**

In `_commit_row`, the create branch merges defaults under the supplied values.
The update branch passes `normalized` untouched, so `exclude_unset=True` in
`update_vm` finally does its job.

Change this line in `_commit_row`:

```python
        vm = create_vm(db, VmCreate.model_validate(normalized), user, commit=False)
```

to:

```python
        vm = create_vm(db, VmCreate.model_validate({**DEFAULTS, **normalized}), user, commit=False)
```

- [ ] **Step 8: Run the full import test file**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -v
```

Expected: all PASS, including the previously failing
`test_partial_column_update_preserves_unmentioned_fields`.

If `test_csv_preview_normalizes_sr_id_os_family_and_backup_enabled` fails,
read its assertions before changing anything: it may assert that a blank
`ha_enabled` normalizes to `False`, which is exactly the behavior this task
intentionally removes. Update that assertion to expect the key to be absent —
do not restore the old behavior.

- [ ] **Step 9: Run ruff**

```bash
cd backend && uv run ruff check app tests
```

Expected: no findings.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "fix(import): only apply CSV fields the file actually supplied

normalize_csv_row emitted every known field regardless of what the CSV
contained, so VmUpdate.model_validate marked them all as set and
update_vm's exclude_unset=True protected nothing. A partial-column
update blanked every unmentioned field.

Blank cell and absent column now both mean skip. DEFAULTS apply on
create only."
```

---

### Task 2: Derive headers from the schema

Kills the drift that made `backup_location` unimportable.

**Files:**
- Modify: `backend/app/services/csv_import.py:28-63`
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: the typed header group constants from Task 1.
- Produces: `ALL_HEADERS: set[str]` derived from `VmBase.model_fields`, `OPTIONAL_HEADERS: set[str]`, `EXCLUDED_FROM_CSV: set[str]`.

- [ ] **Step 1: Write the coverage test**

This is the real anti-drift guard: every importable header must be handled by
one of `normalize_csv_row`'s typed groups. A new `VmBase` field now fails the
suite until someone classifies it.

```python
def test_every_header_is_handled_by_a_typed_group() -> None:
    """A new VmBase field must be classified, not silently ignored."""
    from app.services.csv_import import (
        ALL_HEADERS,
        BOOL_HEADERS,
        CHILD_HEADERS,
        DATE_HEADERS,
        ENUM_HEADERS,
        INT_HEADERS,
        LIST_HEADERS,
        REQUIRED_HEADERS,
        STRING_HEADERS,
    )

    handled = (
        set(STRING_HEADERS)
        | set(ENUM_HEADERS)
        | set(INT_HEADERS)
        | set(BOOL_HEADERS)
        | set(DATE_HEADERS)
        | set(LIST_HEADERS)
        | set(CHILD_HEADERS)
        | REQUIRED_HEADERS
    )
    assert handled == ALL_HEADERS


def test_backup_location_is_importable(client, db_session: Session) -> None:
    """Regression: backup_location shipped in migration 0010 but was never
    added to the CSV header list, so the downloadable template was rejected."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,backup_location",
            "Backed Up,proxmox,pve-cluster-a,veeam-repo-01",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Backed Up"))
    assert created is not None
    assert created.backup_location == "veeam-repo-01"
```

- [ ] **Step 2: Run to verify both fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -k "typed_group or backup_location_is_importable" -v
```

Expected: `test_every_header_is_handled_by_a_typed_group` FAILS (`backup_location`
is in the handled groups but not in the hand-listed `ALL_HEADERS`).
`test_backup_location_is_importable` FAILS with
`400 CSV has unsupported headers: backup_location`.

- [ ] **Step 3: Derive the header sets**

Replace the hand-maintained `REQUIRED_HEADERS` / `OPTIONAL_HEADERS` /
`ALL_HEADERS` block. The ordered tuple is needed by Task 7, which cannot rely
on set iteration order.

```python
REQUIRED_HEADERS_ORDER = ("name", "platform", "cluster")
REQUIRED_HEADERS = set(REQUIRED_HEADERS_ORDER)

# vm_type drives lifecycle gating in services/vms.py::_apply_vm_type_lifecycle;
# letting an import set it is out of scope. disks/networks are child collections
# expressed through CHILD_HEADERS instead.
EXCLUDED_FROM_CSV = {"disks", "networks", "vm_type"}

OPTIONAL_HEADERS = (
    set(VmBase.model_fields) - EXCLUDED_FROM_CSV - REQUIRED_HEADERS
) | CHILD_HEADERS
ALL_HEADERS = REQUIRED_HEADERS | OPTIONAL_HEADERS
```

Extend the existing schema import at the top of the file:

```python
from app.schemas.vms import VmBase, VmCreate, VmUpdate
```

`CHILD_HEADERS` and the typed groups from Task 1 must be defined **above**
this block, since it references `CHILD_HEADERS`.

- [ ] **Step 4: Run to verify both pass**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "fix(import): derive CSV headers from VmBase

ALL_HEADERS was a hand-maintained duplicate of the schema, so
backup_location (migration 0010) was never importable and the
downloadable template was rejected by the endpoint that serves it.

Derive from VmBase.model_fields and assert every header is claimed by a
typed parse group, so a new field fails the suite until classified."
```

---

### Task 3: Ignore unrecognized columns instead of rejecting the file

**Files:**
- Modify: `backend/app/services/csv_import.py` (`parse_csv_bytes`, `create_preview_batch`)
- Modify: `backend/app/db/models.py:334-354` (`CsvImportBatch.ignored_columns`)
- Modify: `backend/app/schemas/imports.py`
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: `ALL_HEADERS` from Task 2.
- Produces: `parse_csv_bytes(content: bytes) -> tuple[list[dict[str, Any]], list[str]]` — now returns `(rows, ignored_columns)`.
- Produces: `CsvImportBatch.ignored_columns: list[str]`, surfaced as `ImportBatchRead.ignored_columns`.

> The DB column itself is created by the single Alembic revision in Task 4.
> Add the `mapped_column` here so the service can populate it, but expect this
> task's tests to fail against the DB until Task 4's migration runs. Run Task 4
> immediately after this one; do not stop in between with a red suite.

- [ ] **Step 1: Write the test**

```python
def test_unrecognized_columns_are_ignored_and_reported(
    client, db_session: Session
) -> None:
    """Hypervisor exports carry columns we do not model. Import what we
    recognize; name what we skipped so a typo'd header is visible."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,vmid,maxmem,uptime",
            "Exported VM,proxmox,pve-cluster-a,alice,101,8589934592,864000",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert sorted(body["ignored_columns"]) == ["maxmem", "uptime", "vmid"]
    assert body["summary"]["create"] == 1

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Exported VM"))
    assert created is not None
    assert created.owner == "alice"
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py::test_unrecognized_columns_are_ignored_and_reported -v
```

Expected: FAIL with `400 CSV has unsupported headers: maxmem, uptime, vmid`.

- [ ] **Step 3: Add the model column**

In `app/db/models.py`, inside `class CsvImportBatch`, after the `summary` line:

```python
    ignored_columns: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
```

- [ ] **Step 4: Return ignored columns from `parse_csv_bytes`**

Replace the `unsupported` rejection block:

```python
    unsupported = sorted(headers - ALL_HEADERS)
    if unsupported:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSV has unsupported headers: {', '.join(unsupported)}",
        )
    rows = list(reader)
```

with:

```python
    ignored = sorted(headers - ALL_HEADERS)
    rows = list(reader)
```

Change the signature and the final return:

```python
def parse_csv_bytes(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
```

```python
    return rows, ignored
```

- [ ] **Step 5: Store them on the batch**

In `create_preview_batch`, change:

```python
    rows = parse_csv_bytes(content)
    batch = CsvImportBatch(
        filename=filename, created_by_id=user.id, status=ImportStatus.previewed, summary={}
    )
```

to:

```python
    rows, ignored_columns = parse_csv_bytes(content)
    batch = CsvImportBatch(
        filename=filename,
        created_by_id=user.id,
        status=ImportStatus.previewed,
        summary={},
        ignored_columns=ignored_columns,
    )
```

- [ ] **Step 6: Expose on the read schema**

In `app/schemas/imports.py`, add to `ImportBatchRead` after `summary`:

```python
    ignored_columns: list[str]
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/csv_import.py backend/app/db/models.py \
        backend/app/schemas/imports.py backend/tests/test_csv_imports.py
git commit -m "feat(import): ignore and report unrecognized CSV columns

Rejecting the whole file meant hand-deleting hypervisor columns before
every import. Ignoring silently would hide a typo'd header. Import what
we recognize and report what we skipped."
```

---

### Task 4: `unchanged` action, change tracking columns, and the migration

**Files:**
- Modify: `backend/app/db/models.py:93-97` (`ImportAction`), `:334-354` (`CsvImportBatch.field_changes`), `:357-378` (`CsvImportRow.changes`)
- Create: `backend/alembic/versions/0011_import_change_tracking.py`
- Modify: `backend/app/services/csv_import.py` (`create_preview_batch`, `commit_batch`)
- Modify: `backend/app/schemas/imports.py`
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: `normalize_csv_row`'s supplied-only dict from Task 1; `CHILD_HEADERS` from Task 1.
- Produces: `ImportAction.unchanged`.
- Produces: `diff_against_vm(normalized: dict[str, Any], vm: Vm) -> dict[str, list[Any]]` returning `{field: [old, new]}` for supplied values that differ.
- Produces: `CsvImportRow.changes: dict[str, list[Any]]`, `CsvImportBatch.field_changes: dict[str, int]`; creates the `ignored_columns` column declared in Task 3.
- Produces: `summary` dict gains an `unchanged` key.

- [ ] **Step 1: Write the round-trip and change-recording tests**

```python
def test_unchanged_rows_are_classified_separately(client, db_session: Session) -> None:
    """Re-importing an unmodified export must not read as N updates."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        cluster="pve-cluster-a",
        owner="alice",
        cpu_cores=8,
    )
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,cpu_cores",
            "Existing App,proxmox,pve-cluster-a,alice,8",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["unchanged"] == 1
    assert body["summary"]["update"] == 0
    assert body["rows"][0]["action"] == "unchanged"
    assert body["rows"][0]["changes"] == {}


def test_update_rows_record_changed_fields(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        cluster="pve-cluster-a",
        owner="alice",
        cpu_cores=8,
    )
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,cpu_cores",
            "Existing App,proxmox,pve-cluster-a,bob,16",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["update"] == 1
    assert body["rows"][0]["changes"] == {"owner": ["alice", "bob"], "cpu_cores": [8, 16]}
    assert body["field_changes"] == {"owner": 1, "cpu_cores": 1}
```

Note `field_changes` is asserted on the **batch**, not the row — it is the
rollup.

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -k "unchanged_rows or record_changed_fields" -v
```

Expected: FAIL with `KeyError: 'unchanged'`.

- [ ] **Step 3: Add the enum value and columns**

In `app/db/models.py`, extend `ImportAction`:

```python
class ImportAction(StrEnum):
    create = "create"
    update = "update"
    unchanged = "unchanged"
    conflict = "conflict"
    invalid = "invalid"
```

In `CsvImportBatch`, after the `ignored_columns` line from Task 3:

```python
    field_changes: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)
```

In `CsvImportRow`, after the `errors` line:

```python
    changes: Mapped[dict[str, list[Any]]] = mapped_column(JSONB, nullable=False, default=dict)
```

- [ ] **Step 4: Write the migration**

Create `backend/alembic/versions/0011_import_change_tracking.py`:

```python
"""Add import change tracking: unchanged action, row changes, batch rollups.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE import_action ADD VALUE IF NOT EXISTS 'unchanged' AFTER 'update'")
    op.add_column(
        "csv_import_rows",
        sa.Column("changes", JSONB, nullable=False, server_default="{}"),
    )
    op.add_column(
        "csv_import_batches",
        sa.Column("field_changes", JSONB, nullable=False, server_default="{}"),
    )
    op.add_column(
        "csv_import_batches",
        sa.Column("ignored_columns", JSONB, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("csv_import_batches", "ignored_columns")
    op.drop_column("csv_import_batches", "field_changes")
    op.drop_column("csv_import_rows", "changes")
    # Postgres cannot drop a value from an enum type. Leaving 'unchanged' in
    # place is harmless: no row references it once the columns above are gone.
```

If the migration errors with `ALTER TYPE ... cannot run inside a transaction
block`, add `op.execute("COMMIT")` immediately before the `ALTER TYPE` line —
the standard Alembic workaround for extending an enum.

- [ ] **Step 5: Run the migration**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head
```

Expected: `Running upgrade 0010 -> 0011`.

- [ ] **Step 6: Implement the diff and classification**

Add to `app/services/csv_import.py`:

```python
def diff_against_vm(normalized: dict[str, Any], vm: Vm) -> dict[str, list[Any]]:
    """Supplied values that differ from the VM's current state, as {field: [old, new]}.

    Only keys present in `normalized` are considered — an absent column can
    never register as a change.
    """
    changes: dict[str, list[Any]] = {}
    for field, new_value in normalized.items():
        if field in CHILD_HEADERS:
            continue
        if not hasattr(vm, field):
            continue
        old_value = getattr(vm, field)
        # StrEnum and date columns compare cleanly against their string form.
        old_comparable = old_value.value if isinstance(old_value, StrEnum) else old_value
        if isinstance(old_comparable, date):
            old_comparable = old_comparable.isoformat()
        if old_comparable != new_value:
            changes[field] = [old_comparable, new_value]
    return changes
```

Add `from enum import StrEnum` to the imports at the top of the file.

In `create_preview_batch`, initialize the new summary key and the rollup
accumulator alongside the existing `summary` line:

```python
    summary = {"create": 0, "update": 0, "unchanged": 0, "conflict": 0, "invalid": 0}
    field_changes: dict[str, int] = {}
```

Inside the row loop, reset the per-row map next to the existing `action` and
`target_vm_id` initializers:

```python
        changes: dict[str, list[Any]] = {}
```

Replace the classification block:

```python
            else:
                seen.add(key)
                match = find_matching_vm(db, normalized)
                if match is None:
                    action = ImportAction.create
                else:
                    action = ImportAction.update
                    target_vm_id = match.id
```

with:

```python
            else:
                seen.add(key)
                match = find_matching_vm(db, normalized)
                if match is None:
                    action = ImportAction.create
                else:
                    target_vm_id = match.id
                    changes = diff_against_vm(normalized, match)
                    action = ImportAction.update if changes else ImportAction.unchanged
                    for field in changes:
                        field_changes[field] = field_changes.get(field, 0) + 1
```

Pass the map into the row:

```python
        db.add(
            CsvImportRow(
                batch_id=batch.id,
                row_number=idx,
                raw=_clean_row(raw),
                normalized=normalized,
                action=action,
                target_vm_id=target_vm_id,
                errors=errors,
                changes=changes,
            )
        )
```

and store the rollup on the batch, next to the existing `batch.summary` line:

```python
    batch.summary = summary
    batch.field_changes = field_changes
```

- [ ] **Step 7: Skip unchanged rows at commit**

In `commit_batch`, unchanged rows must not be written. Change:

```python
    for row in batch.rows:
        try:
```

to:

```python
    for row in batch.rows:
        if row.action == ImportAction.unchanged:
            continue
        try:
```

- [ ] **Step 8: Expose on the read schemas**

In `app/schemas/imports.py`, add to `ImportRowRead`:

```python
    changes: dict[str, list[Any]]
```

and to `ImportBatchRead`:

```python
    field_changes: dict[str, int]
```

- [ ] **Step 9: Run the full backend suite**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -v
```

Expected: all PASS. `test_csv_preview_persists_classification_for_create_update_conflict_and_invalid`
asserts `body["summary"] == {"create": 1, "update": 1, "conflict": 1, "invalid": 1}`
and will fail on the new key — update it to include `"unchanged": 0`. Verify
its update row genuinely changes something; if it does not, it now classifies
as `unchanged` and the assertion should say so.

- [ ] **Step 10: Commit**

```bash
git add backend/app/db/models.py backend/app/services/csv_import.py \
        backend/app/schemas/imports.py \
        backend/alembic/versions/0011_import_change_tracking.py \
        backend/tests/test_csv_imports.py
git commit -m "feat(import): add unchanged action and change tracking

A faithful round-trip previously read as N updates, training operators
to ignore the number. Rows matching an existing VM with no differing
supplied value now classify as unchanged and are skipped at commit.

Records per-row {field: [old, new]} and a batch-level {field: count}
rollup for the preview."
```

---

### Task 5: Additive disk and IP attach on update

**Files:**
- Modify: `backend/app/services/csv_import.py` (`_commit_row`)
- Test: `backend/tests/test_csv_imports.py`

**Interfaces:**
- Consumes: `CHILD_HEADERS` from Task 1; `ImportAction` from Task 4.
- Produces: `_attach_children(db: Session, vm: Vm, raw: dict[str, Any]) -> None` — shared by both branches of `_commit_row`.

Matching rule, pinned during planning: a disk matches on `disk_name`
case-insensitively; an IP matches on exact `ip_address`. Size is not part of
disk identity — a disk named `os` that grew from 50 to 100 GB is the same
disk, not a second one.

- [ ] **Step 1: Write the tests**

```python
def test_disk_and_ip_attach_additively_on_update(client, db_session: Session) -> None:
    """Children were parsed and previewed on update, then discarded at commit."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=50, sort_order=0))
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disk_name,disk_gb,ip_address",
            "Existing App,proxmox,pve-cluster-a,data,500,10.0.0.6",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    networks = db_session.scalars(select(VmNetwork).where(VmNetwork.vm_id == vm_id)).all()

    # Added, and the pre-existing children survive.
    assert sorted(d.disk_name for d in disks) == ["data", "os"]
    assert sorted(n.ip_address for n in networks) == ["10.0.0.5", "10.0.0.6"]


def test_repeated_import_does_not_duplicate_children(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=50, sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    # Same disk name, different size and case — same disk, no second row.
    csv_content = "\n".join(
        [
            "name,platform,cluster,disk_name,disk_gb",
            "Existing App,proxmox,pve-cluster-a,OS,100",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    assert len(disks) == 1
```

Add `VmDisk, VmNetwork` to the model imports at the top of the test file.

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -k "attach_additively or not_duplicate_children" -v
```

Expected: `test_disk_and_ip_attach_additively_on_update` FAILS —
`assert ['os'] == ['data', 'os']`.

- [ ] **Step 3: Extract the shared attach helper**

Add to `app/services/csv_import.py`:

```python
def _attach_children(db: Session, vm: Vm, raw: dict[str, Any]) -> None:
    """Attach the row's disk and IP if the VM has no matching one.

    Additive only: existing children are never modified or removed. One CSV
    row carries at most one disk and one IP, so a replace would delete
    children the import never mentioned.

    ponytail: matches disk on name and IP on address; a size change on an
    existing disk is ignored rather than applied. Multi-disk VMs are managed
    in the VM form until spec 3 lands multi-value columns.
    """
    disk_name = str(raw.get("disk_name") or "").strip()
    disk_gb = raw.get("disk_gb")
    ip_address = str(raw.get("ip_address") or "").strip()

    if disk_name:
        existing = {(d.disk_name or "").lower() for d in vm.disks}
        if disk_name.lower() not in existing:
            db.add(
                VmDisk(
                    vm_id=vm.id,
                    disk_name=disk_name,
                    size_gb=int(disk_gb) if str(disk_gb or "").strip().isdigit() else 0,
                    sort_order=len(vm.disks),
                )
            )

    if ip_address:
        existing_ips = {n.ip_address for n in vm.networks}
        if ip_address not in existing_ips:
            db.add(VmNetwork(vm_id=vm.id, ip_address=ip_address, sort_order=len(vm.networks)))
```

Rewrite `_commit_row`'s branches to call it, replacing the inline create-only
child block:

```python
    if row.action == ImportAction.create:
        vm = create_vm(db, VmCreate.model_validate({**DEFAULTS, **normalized}), user, commit=False)
        db.flush()
        _attach_children(db, vm, row.raw)
        return "create", vm
    if row.target_vm_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    vm = db.get(Vm, row.target_vm_id)
    if vm is None or find_matching_vm(db, row.normalized) != vm:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import target VM changed")
    update_vm(db, vm, VmUpdate.model_validate(normalized), user, commit=False)
    _attach_children(db, vm, row.raw)
    return "update", vm
```

- [ ] **Step 4: Run the full backend suite**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -v
```

Expected: all PASS. `health_score` is recomputed once for all touched VMs
after the loop in `commit_batch`, which runs after `db.flush()`, so the newly
attached children are included.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_imports.py
git commit -m "fix(import): attach disk and IP on update, not just create

Children were parsed and shown in the preview on update rows, then
discarded at commit. Attach additively, matching disks by name and IPs
by address so a repeated import does not duplicate them."
```

---

### Task 6: Frontend — unchanged card, change counts, rollup, ignored columns

**Files:**
- Modify: `frontend/src/api/client.ts` (`ImportAction`, `ImportBatch`)
- Modify: `frontend/src/routes/ImportCsvPage.tsx`
- Test: `frontend/src/test/ImportCsvPage.test.tsx`

**Interfaces:**
- Consumes: `ignored_columns` (Task 3), `field_changes` and per-row `changes` (Task 4).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the tests**

```tsx
it('shows unchanged rows in their own summary card', async () => {
  server.use(
    http.post('*/api/imports/preview', () =>
      HttpResponse.json(makeBatch({
        summary: { create: 0, update: 0, unchanged: 2, conflict: 0, invalid: 0 },
      }), { status: 201 }),
    ),
  );
  renderWithProviders(<ImportCsvPage />);
  await uploadFixture();

  const card = await screen.findByTestId('summary-unchanged');
  expect(within(card).getByText('2')).toBeInTheDocument();
});

it('summarizes which fields the import will change', async () => {
  server.use(
    http.post('*/api/imports/preview', () =>
      HttpResponse.json(makeBatch({
        summary: { create: 0, update: 40, unchanged: 0, conflict: 0, invalid: 0 },
        field_changes: { owner: 40, status: 3 },
      }), { status: 201 }),
    ),
  );
  renderWithProviders(<ImportCsvPage />);
  await uploadFixture();

  expect(await screen.findByText(/owner on 40 VMs/i)).toBeInTheDocument();
  expect(screen.getByText(/status on 3 VMs/i)).toBeInTheDocument();
});

it('warns about ignored columns', async () => {
  server.use(
    http.post('*/api/imports/preview', () =>
      HttpResponse.json(makeBatch({ ignored_columns: ['vmid', 'maxmem'] }), { status: 201 }),
    ),
  );
  renderWithProviders(<ImportCsvPage />);
  await uploadFixture();

  expect(await screen.findByText(/2 columns ignored/i)).toBeInTheDocument();
  expect(screen.getByText(/vmid/)).toBeInTheDocument();
});
```

Follow the existing file's conventions. If `makeBatch` and `uploadFixture`
helpers do not exist there yet, define them at the top of the test file from
the batch shapes the existing tests already build inline, so the three tests
above stay readable.

- [ ] **Step 2: Run to verify they fail**

```bash
cd frontend && bun run test src/test/ImportCsvPage.test.tsx
```

Expected: FAIL — `summary-unchanged` not found.

- [ ] **Step 3: Extend the client types**

In `frontend/src/api/client.ts`:

```ts
export type ImportAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid';
```

Add to the `ImportBatch` interface:

```ts
  ignored_columns: string[];
  field_changes: Record<string, number>;
```

Add to the row type inside `ImportBatch['rows']`:

```ts
  changes: Record<string, [unknown, unknown]>;
```

- [ ] **Step 4: Add `unchanged` to the page's action list and colors**

In `ImportCsvPage.tsx`:

```tsx
const actions: ImportAction[] = ['create', 'update', 'unchanged', 'conflict', 'invalid'];

const actionBorderColor: Record<ImportAction, string> = {
  create: 'border-l-emerald-500',
  update: 'border-l-blue-500',
  unchanged: 'border-l-slate-400',
  conflict: 'border-l-amber-500',
  invalid: 'border-l-red-500',
};
```

Add `unchanged: number;` to the `PreviewSummary` interface and `unchanged: 0`
to `summarizePreview`'s `counts` initializer.

Change the summary grid from `sm:grid-cols-4` to `sm:grid-cols-5`, and add a
test id to the card:

```tsx
<div key={action} data-testid={`summary-${action}`} className={...}>
```

- [ ] **Step 5: Add the rollup panel**

Directly after the summary grid, before the preview table:

```tsx
{Object.keys(batch.field_changes ?? {}).length > 0 ? (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
      This import will change:
    </p>
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
      {Object.entries(batch.field_changes)
        .sort((a, b) => b[1] - a[1])
        .map(([field, count]) => (
          <li key={field}>
            <span className="font-medium text-slate-900 dark:text-slate-100">{field}</span>
            {' on '}
            {count}
            {' VMs'}
          </li>
        ))}
    </ul>
  </div>
) : null}
```

- [ ] **Step 6: Add the ignored-columns warning**

Directly after the `commit.isSuccess` alert:

```tsx
{batch && batch.ignored_columns?.length > 0 ? (
  <Alert tone="warning">
    {batch.ignored_columns.length} columns ignored: {batch.ignored_columns.join(', ')}.
    Check for a misspelled header if you expected one of these to import.
  </Alert>
) : null}
```

If `Alert` does not accept `tone="warning"`, check `components/ui.tsx` for the
supported tones and use the closest one rather than adding a variant.

- [ ] **Step 7: Show the changed-field count per row**

In `ImportRow`, replace the action cell:

```tsx
<td className="whitespace-nowrap px-4 py-3"><Badge value={row.action} /></td>
```

with:

```tsx
<td className="whitespace-nowrap px-4 py-3">
  <Badge value={row.action} />
  {row.action === 'update' && Object.keys(row.changes ?? {}).length > 0 ? (
    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
      {Object.keys(row.changes).length} fields
    </span>
  ) : null}
</td>
```

- [ ] **Step 8: Update the help text for the new semantics**

Replace the `csv-help` paragraph:

```tsx
<p id="csv-help" className={helpTextClass}>
  Required headers: name, platform, cluster. Maximum 5 MiB and 5000 rows.
  Blank cells are left unchanged on existing VMs and take default values on
  new ones — importing never clears a field. Multi-disk VMs are managed in
  the VM form.
</p>
```

- [ ] **Step 9: Run frontend tests and typecheck**

```bash
cd frontend && bun run test src/test/ImportCsvPage.test.tsx && bun run typecheck
```

Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/routes/ImportCsvPage.tsx \
        frontend/src/test/ImportCsvPage.test.tsx
git commit -m "feat(import): surface unchanged rows, field rollup, ignored columns

The rollup is the safety net: an unintended mass change shows as
'cpu_cores on 812 VMs' before commit, independent of whether the
normalization fix is correct."
```

---

### Task 7: Serve the CSV template from the API

Deletes the frontend's duplicate header list so template drift becomes impossible.

**Files:**
- Modify: `backend/app/api/routes/imports.py`
- Modify: `frontend/src/routes/ImportCsvPage.tsx`
- Test: `backend/tests/test_csv_imports.py`, `frontend/src/test/ImportCsvPage.test.tsx`

**Interfaces:**
- Consumes: `ALL_HEADERS`, `REQUIRED_HEADERS`, `REQUIRED_HEADERS_ORDER` from Task 2.
- Produces: `GET /api/imports/template` returning `text/csv`.

- [ ] **Step 1: Write the backend test**

```python
def test_template_endpoint_serves_importable_headers(client, db_session: Session) -> None:
    """The template must round-trip: every header it offers must be one the
    preview endpoint accepts."""
    from app.services.csv_import import ALL_HEADERS

    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    login(client, "viewer@example.local")

    response = client.get("/api/imports/template")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")

    headers = response.text.strip().split(",")
    assert set(headers) == ALL_HEADERS
    assert headers[:3] == ["name", "platform", "cluster"]
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py::test_template_endpoint_serves_importable_headers -v
```

Expected: FAIL with 404.

- [ ] **Step 3: Add the endpoint**

In `app/api/routes/imports.py`. It must be declared **before**
`GET /{batch_id}`, or `template` is parsed as a batch UUID and 422s.

```python
from fastapi.responses import PlainTextResponse

from app.services.csv_import import (
    ALL_HEADERS,
    REQUIRED_HEADERS,
    REQUIRED_HEADERS_ORDER,
    commit_batch,
    create_preview_batch,
    load_batch_or_404,
)


@router.get("/template", response_class=PlainTextResponse)
def download_template(current_user: ViewerUser) -> PlainTextResponse:
    """Serve the CSV header row, derived from the same set the importer accepts."""
    ordered = list(REQUIRED_HEADERS_ORDER) + sorted(ALL_HEADERS - REQUIRED_HEADERS)
    return PlainTextResponse(
        ",".join(ordered) + "\n",
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vm-import-template.csv"'},
    )
```

This is a read-only GET, so it takes `ViewerUser` and no `Csrf`.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" \
  uv run pytest tests/test_csv_imports.py -v
```

Expected: all PASS.

- [ ] **Step 5: Point the frontend at the endpoint**

First find everything referencing the constant:

```bash
cd frontend && grep -rn "TEMPLATE_HEADERS" src/
```

Delete the exported `TEMPLATE_HEADERS` constant from `ImportCsvPage.tsx` and
replace `downloadTemplate`:

```tsx
function downloadTemplate() {
  const anchor = document.createElement('a');
  anchor.href = '/api/imports/template';
  anchor.download = 'vm-import-template.csv';
  anchor.click();
}
```

Remove any test asserting on the constant's contents — that assertion now
lives in the backend test from Step 1.

- [ ] **Step 6: Run frontend tests and typecheck**

```bash
cd frontend && bun run test && bun run typecheck
```

Expected: all PASS, no type errors.

- [ ] **Step 7: Run the whole verification suite**

```bash
just verify
```

Expected: ruff, pytest, lint, typecheck, vitest, and playwright all green.
If the Playwright import spec asserts the old four-card summary or the old
rejection behavior for unknown columns, update it to the new expectations.

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/routes/imports.py backend/tests/test_csv_imports.py \
        frontend/src/routes/ImportCsvPage.tsx frontend/src/test/ImportCsvPage.test.tsx
git commit -m "feat(import): serve CSV template from the API

The frontend kept its own header list, which drifted from the backend's
and produced a template the import endpoint rejected. Serve it from the
same set the importer accepts so the two cannot disagree."
```

---

## Verification

After all tasks, drive the real flow rather than trusting the suite:

1. `just db-up && just api-dev`, and `just web-dev`.
2. Create a VM through the UI with owner, fqdn, cpu_cores, and a disk.
3. Download the template from the Import page, keep only
   `name,platform,cluster,owner`, fill one row matching that VM with a new owner.
4. Preview. Expect: 1 update, rollup reads "owner on 1 VMs", row shows "1 fields".
5. Commit, open the VM. Expect: owner changed, **fqdn and cpu_cores intact**,
   disk still present.
6. Re-upload the same file. Expect: 1 unchanged, 0 update, commit is a no-op.
7. Add a junk column, re-upload. Expect: ignored-columns warning, import still works.

Step 5 is the one that matters — it is the bug this plan exists to fix.
