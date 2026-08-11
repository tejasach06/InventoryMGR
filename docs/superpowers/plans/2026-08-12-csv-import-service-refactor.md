# CSV Import Service Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract CSV constants, byte decoding, parsing, and row normalization from the database-backed import orchestrator while preserving the existing `app.services.csv_import` interface and all import contracts.

**Architecture:** Add one dependency-light `csv_import_parsing.py` module containing the existing parsing code byte-for-byte, and keep `csv_import.py` responsible for matching, preview persistence, diffing, additive child attachment, commit transactions, audit delegation, and health recomputation. `csv_import.py` remains a compatibility facade by explicitly re-exporting every existing public constant and function used by routes, export, and tests.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest, Ruff, PostgreSQL 16, Devbox, uv

## Global Constraints

- Prerequisite: complete `2026-08-12-backend-test-harness-restoration.md`; its Ruff gate and `11 passed` pytest gate must be green before Task 1.
- This plan is the second gate; do not begin `2026-08-12-vm-service-refactor.md` until Task 2's full backend gate passes.
- Preserve routes, request/response schemas, status codes, error details, CSV headers, template layout, aliases, defaults, duplicate identity rules, preview summaries, additive child semantics, audit rows, transaction rollback, and health-score recomputation.
- Add characterization coverage before changing production code.
- Make no migration, model, route, schema, frontend, dependency, or configuration changes.
- Keep these current signatures unchanged at the compatibility module: `normalize_csv_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, str]]]`, `identity_key(normalized: dict[str, Any]) -> tuple[str, ...]`, `parse_csv_bytes(content: bytes) -> tuple[list[dict[str, Any]], list[str]]`, `find_matching_vm(db: Session, normalized: dict[str, Any]) -> Vm | None`, `create_preview_batch(db: Session, *, filename: str, content: bytes, user: User) -> CsvImportBatch`, `diff_against_vm(normalized: dict[str, Any], vm: Vm, raw: dict[str, Any] | None = None) -> dict[str, list[Any]]`, `load_batch_or_404(db: Session, batch_id: uuid.UUID, user: User) -> CsvImportBatch`, and `commit_batch(db: Session, *, batch_id: uuid.UUID, user: User) -> dict[str, int]`.
- Keep `TEMPLATE_COLUMNS`, `TEMPLATE_SAMPLE_ROWS`, and `IP_ROLE_HEADERS` importable from `app.services.csv_import`; no route or export import changes are allowed.
- Run every project command through Devbox from `/home/tejas/project/InventoryMGR`.
- `backend/tests/` and `docs/` are ignored by `.gitignore`; stage new tests with `git add -f`.
- Do not delete, stage, or rewrite unrelated untracked files.

---

### Task 1: Characterize parsing, preview, commit, audit, and health contracts

**Files:**
- Create: `backend/tests/test_csv_import_service.py`
- Test: `backend/tests/test_csv_import_service.py`

**Interfaces:**
- Consumes: the eight unchanged service signatures listed in Global Constraints plus `ImportAction`, `AuditLog`, and the restored `create_user()`/`create_vm_row()` test helpers.
- Produces: three regression tests that later extraction tasks must keep green without modifying their assertions.

- [ ] **Step 1: Create the focused characterization test module**

```python
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import AuditLog, ImportAction, UserRole, Vm
from app.services.csv_import import (
    commit_batch,
    create_preview_batch,
    normalize_csv_row,
    parse_csv_bytes,
)

from .conftest import create_user, create_vm_row


def test_parse_and_normalize_preserve_current_csv_contract() -> None:
    rows, ignored = parse_csv_bytes(
        b"name,platform,cluster,cpu_cores,monitoring_enabled,tags,disks,private_ip,applications,ignored\n"
        b" app-01 ,PVE,pve-a,4,yes,prod; web,os:80:ssd:thin,10.0.0.5,nginx:web-team,value\n"
    )

    normalized, errors = normalize_csv_row(rows[0])

    assert ignored == ["ignored"]
    assert errors == []
    assert normalized == {
        "name": "app-01",
        "platform": "proxmox",
        "cluster": "pve-a",
        "cpu_cores": 4,
        "monitoring_enabled": True,
        "tags": ["prod", "web"],
    }


def test_normalize_rejects_invalid_values_with_exact_errors() -> None:
    normalized, errors = normalize_csv_row(
        {
            "name": "",
            "platform": "hyperv",
            "cluster": "",
            "cpu_cores": "-1",
            "monitoring_enabled": "sometimes",
            "disks": "os:not-a-size",
            "private_ip": "10.0.0.5:42",
            "applications": ":owner",
            "last_verified_at": "12/08/2026",
        }
    )

    assert normalized is None
    assert sorted(errors, key=lambda error: error["field"]) == [
        {"field": "applications", "message": "must be name or name:owner entries separated by ;"},
        {"field": "cluster", "message": "is required and cannot be blank"},
        {"field": "cpu_cores", "message": "must be an integer >= 0"},
        {"field": "disks", "message": "must be name:size[:storage_name[:storage_type]] separated by ;"},
        {"field": "last_verified_at", "message": "must be ISO date YYYY-MM-DD"},
        {"field": "monitoring_enabled", "message": "must be one of true, false, yes, no, 1, 0"},
        {"field": "name", "message": "is required and cannot be blank"},
        {"field": "platform", "message": "must be one of proxmox, pve, vmware, vsphere, vcenter"},
        {"field": "private_ip", "message": "must be IP addresses separated by ;"},
    ]


def test_preview_and_commit_preserve_matching_additive_children_audit_and_health(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-service@example.com", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Existing App",
        platform="proxmox",
        external_id="101",
        datacenter="dc-a",
        node="pve-01",
        owner="old-owner",
        monitoring_enabled=False,
    )
    initial_health = vm.health_score
    content = (
        b"name,platform,cluster,external_id,datacenter,node,owner,monitoring_enabled,disks,private_ip,applications\n"
        b"Existing App,pve,pve-cluster-a,101,dc-a,pve-01,new-owner,true,os:80:ssd:thin,10.0.0.5,nginx:web-team\n"
    )

    batch = create_preview_batch(
        db_session, filename="inventory.csv", content=content, user=editor
    )

    assert batch.summary == {
        "create": 0,
        "update": 1,
        "unchanged": 0,
        "conflict": 0,
        "invalid": 0,
    }
    assert batch.field_changes == {
        "applications": 1,
        "disks": 1,
        "monitoring_enabled": 1,
        "owner": 1,
        "private_ip": 1,
    }
    assert batch.rows[0].action == ImportAction.update
    assert batch.rows[0].target_vm_id == vm.id
    assert batch.rows[0].changes == {
        "disks": [None, ["os:80"]],
        "applications": [None, ["nginx"]],
        "private_ip": [None, ["10.0.0.5"]],
        "owner": ["old-owner", "new-owner"],
        "monitoring_enabled": [False, True],
    }

    assert commit_batch(db_session, batch_id=batch.id, user=editor) == {
        "created": 0,
        "updated": 1,
    }
    reloaded = db_session.scalar(
        select(Vm)
        .options(
            selectinload(Vm.disks),
            selectinload(Vm.networks),
            selectinload(Vm.applications),
        )
        .where(Vm.id == vm.id)
    )
    assert reloaded is not None
    assert [(d.disk_name, d.size_gb, d.storage_name, d.storage_type) for d in reloaded.disks] == [
        ("os", 80, "ssd", "thin")
    ]
    assert [(n.ip_address, n.role.value) for n in reloaded.networks] == [("10.0.0.5", "private")]
    assert [(a.app_name, a.app_owner) for a in reloaded.applications] == [("nginx", "web-team")]
    assert reloaded.health_score > initial_health
    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.vm_id == vm.id).order_by(AuditLog.field_name)
    ).all()
    assert [(entry.field_name, entry.old_value, entry.new_value) for entry in audits] == [
        ("monitoring_enabled", "False", "True"),
        ("owner", "old-owner", "new-owner"),
    ]
```

Save the code exactly as `backend/tests/test_csv_import_service.py`.

- [ ] **Step 2: Run the characterization tests against the unmodified service**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_csv_import_service.py -q'
```

Expected: `3 passed`. These are characterization tests of current behavior, so passing before extraction is the required baseline; any failure means the asserted contract or fixture data must be reconciled with the current source before proceeding.

- [ ] **Step 3: Lint and re-run the focused characterization module**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check tests/test_csv_import_service.py && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_csv_import_service.py -q'
```

Expected: Ruff passes and pytest reports `3 passed`.

- [ ] **Step 4: Commit the characterization boundary**

```bash
cd /home/tejas/project/InventoryMGR
git add -f backend/tests/test_csv_import_service.py
git diff --cached --check
git commit -m "test: characterize csv import service"
```

Expected: the commit contains only `backend/tests/test_csv_import_service.py`.

---

### Task 2: Extract pure CSV parsing behind the existing service facade

**Files:**
- Create: `backend/app/services/csv_import_parsing.py`
- Modify: `backend/app/services/csv_import.py`
- Test: `backend/tests/test_csv_import_service.py`

**Interfaces:**
- Consumes: the Task 1 characterization suite and the existing parsing blocks delimited by `MAX_CSV_BYTES =`, `def find_matching_vm`, `def parse_csv_bytes`, and `def _storage_warnings`.
- Produces: `app.services.csv_import_parsing` as the owner of constants and pure parsing/normalization; `app.services.csv_import` continues to produce every compatibility name and exact signature listed in Global Constraints.

- [ ] **Step 1: Perform the bounded extraction with exact source markers**

Run this from the backend directory; it moves the current blocks without rewriting their bodies and fails naturally if the source markers drift:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from pathlib import Path

service_path = Path("app/services/csv_import.py")
source = service_path.read_text()
constants_and_normalizers = source[
    source.index("MAX_CSV_BYTES ="):source.index("def find_matching_vm")
]
byte_parser = source[
    source.index("def parse_csv_bytes"):source.index("def _storage_warnings")
]
parsing_source = """import csv
import io
from datetime import date
from typing import Any

from fastapi import HTTPException, status

from app.db.models import NetworkRole
from app.schemas.vms import VmBase


""" + constants_and_normalizers + byte_parser
Path("app/services/csv_import_parsing.py").write_text(parsing_source)

source = source.replace("import csv\nimport io\n", "")
source = source.replace("    NetworkRole,\n", "")
source = source.replace("from app.schemas.vms import VmBase, VmCreate, VmUpdate\n", "from app.schemas.vms import VmCreate, VmUpdate\n")
source = source.replace(constants_and_normalizers, "")
source = source.replace(byte_parser, "")
imports = """from app.services.csv_import_parsing import (
    ALL_HEADERS,
    BOOL_HEADERS,
    CHILD_HEADERS,
    DATE_HEADERS,
    DEFAULTS,
    DISK_DEFAULT_HEADERS,
    ENUM_HEADERS,
    ENUM_VALUES,
    EXCLUDED_FROM_CSV,
    INT_HEADERS,
    IP_ROLE_HEADERS,
    LIST_HEADERS,
    MAX_CSV_BYTES,
    MAX_CSV_ROWS,
    OPTIONAL_HEADERS,
    PLATFORM_ALIASES,
    REQUIRED_HEADERS,
    REQUIRED_HEADERS_ORDER,
    STRING_HEADERS,
    TEMPLATE_COLUMNS,
    TEMPLATE_GROUPS,
    TEMPLATE_SAMPLE_ROWS,
    _clean_row,
    _error,
    _parse_applications,
    _parse_disks,
    _parse_ips,
    identity_key,
    normalize_csv_row,
    parse_csv_bytes,
)
"""
source = source.replace("from app.services.vms import create_vm, update_vm\n", "from app.services.vms import create_vm, update_vm\n" + imports)
exports = """
__all__ = [
    "ALL_HEADERS",
    "BOOL_HEADERS",
    "CHILD_HEADERS",
    "DATE_HEADERS",
    "DEFAULTS",
    "DISK_DEFAULT_HEADERS",
    "ENUM_HEADERS",
    "ENUM_VALUES",
    "EXCLUDED_FROM_CSV",
    "INT_HEADERS",
    "IP_ROLE_HEADERS",
    "LIST_HEADERS",
    "MAX_CSV_BYTES",
    "MAX_CSV_ROWS",
    "OPTIONAL_HEADERS",
    "PLATFORM_ALIASES",
    "REQUIRED_HEADERS",
    "REQUIRED_HEADERS_ORDER",
    "STRING_HEADERS",
    "TEMPLATE_COLUMNS",
    "TEMPLATE_GROUPS",
    "TEMPLATE_SAMPLE_ROWS",
    "commit_batch",
    "create_preview_batch",
    "diff_against_vm",
    "find_matching_vm",
    "identity_key",
    "load_batch_or_404",
    "normalize_csv_row",
    "parse_csv_bytes",
]

"""
source = source.replace("\n\ndef find_matching_vm", exports + "def find_matching_vm", 1)
service_path.write_text(source)
PY'
```

Expected: `csv_import_parsing.py` owns CSV constants, template data, `_clean_row`, scalar/child parsers, `normalize_csv_row`, `identity_key`, and `parse_csv_bytes`; `csv_import.py` owns all SQLAlchemy/database orchestration and explicitly re-exports its previous public surface through `__all__`.

- [ ] **Step 2: Apply Ruff's deterministic import organization, then inspect the boundary**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check --fix app/services/csv_import.py app/services/csv_import_parsing.py tests/test_csv_import_service.py && uv run ruff check app/services/csv_import.py app/services/csv_import_parsing.py tests/test_csv_import_service.py'
```

Expected: Ruff may report two fixed import-order errors on the first command, then `All checks passed!`; no rule other than import organization should be changed.

- [ ] **Step 3: Verify facade imports and focused behavior**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from app.services.csv_import import (
    IP_ROLE_HEADERS,
    TEMPLATE_COLUMNS,
    TEMPLATE_SAMPLE_ROWS,
    commit_batch,
    create_preview_batch,
    identity_key,
    normalize_csv_row,
    parse_csv_bytes,
)

assert IP_ROLE_HEADERS["private_ip"].value == "private"
assert TEMPLATE_COLUMNS[0:4] == ("name", "external_id", "fqdn", "sr_id")
assert len(TEMPLATE_SAMPLE_ROWS) == 2
assert all(callable(value) for value in (
    commit_batch,
    create_preview_batch,
    identity_key,
    normalize_csv_row,
    parse_csv_bytes,
))
PY
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_csv_import_service.py tests/test_accent_preference.py tests/test_ldap_auth.py -q'
```

Expected: compatibility import assertions pass and pytest reports `14 passed`.

- [ ] **Step 4: Run the complete backend phase gate**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q'
```

Expected: Ruff passes and pytest reports `14 passed`; warnings are allowed, failures are not. If the gate fails, repair or revert this extraction before starting the VM plan.

- [ ] **Step 5: Commit the independently reversible parsing extraction**

```bash
cd /home/tejas/project/InventoryMGR
git add backend/app/services/csv_import.py backend/app/services/csv_import_parsing.py
git diff --cached --check
git commit -m "refactor: extract csv import parsing"
```

Expected: the commit contains exactly the compatibility-facade edit and the new parsing module; no route, schema, model, migration, or test assertion changes are staged.
