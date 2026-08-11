# VM Service Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate VM mutation and fleet-query responsibilities from `app.services.vms` while retaining `app.services.vms` as the unchanged compatibility surface for every current caller.

**Architecture:** First extract create/update/delete/recompute code into `vm_mutations.py`, leaving detail loading and clone orchestration in the facade. Then extract filter construction, alert conditions, sorting, and pagination into `vm_filters.py`; routes, bulk services, CSV imports, and audit code continue importing the same names from `app.services.vms`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2, psycopg, pytest, Ruff, PostgreSQL 16, Devbox, uv

## Global Constraints

- Prerequisite: complete both `2026-08-12-backend-test-harness-restoration.md` and `2026-08-12-csv-import-service-refactor.md`; the CSV plan's Ruff gate and `14 passed` pytest gate must be green before Task 1.
- Preserve routes, request/response schemas, status codes, identity-conflict detail, transaction behavior, VM/child persistence, audit rows, health scores, clone semantics, filter operators, alert predicates, query result uniqueness, semantic sort order, pagination, and total counts.
- Add characterization coverage before changing production code.
- Make no migration, model, route, schema, frontend, dependency, or configuration changes.
- Keep these mutation signatures unchanged at `app.services.vms`: `create_vm(db: Session, payload: VmCreate, user: User, *, commit: bool = True) -> Vm`, `update_vm(db: Session, vm: Vm, payload: VmUpdate, user: User, *, commit: bool = True) -> Vm`, `delete_vm(db: Session, vm: Vm) -> None`, and `recompute_health(db: Session, vm_id: uuid.UUID) -> None`.
- Keep these facade/query signatures unchanged: `get_vm_or_404(db: Session, vm_id: uuid.UUID) -> Vm`, `get_vm_detail_or_404(db: Session, vm_id: uuid.UUID) -> Vm`, `to_vm_read(vm: Vm) -> VmRead`, `clone_vm(db: Session, vm: Vm, user: User) -> Vm`, `apply_vm_filters(stmt: Select[tuple[Vm]], *, q: str | None = None, platform: list[Platform] | None = None, platform_op: FilterOperator = FilterOperator.eq, cluster: list[str] | None = None, status_value: list[VmStatus] | None = None, status_op: FilterOperator = FilterOperator.eq, environment: list[Environment] | None = None, environment_op: FilterOperator = FilterOperator.eq, criticality: list[Criticality] | None = None, criticality_op: FilterOperator = FilterOperator.eq, monitoring_enabled: bool | None = None, monitoring_enabled_op: FilterOperator = FilterOperator.eq, node: list[str] | None = None, node_op: FilterOperator = FilterOperator.eq, os_family: list[OsFamily] | None = None, os_family_op: FilterOperator = FilterOperator.eq, owner: list[str] | None = None, owner_op: FilterOperator = FilterOperator.eq, pmp_enabled: bool | None = None, pmp_enabled_op: FilterOperator = FilterOperator.eq, tag: list[str] | None = None, tag_op: FilterOperator = FilterOperator.eq, application: list[str] | None = None, application_op: FilterOperator = FilterOperator.contains, ip_role: list[NetworkRole] | None = None, health: str | None = None, shutdown_stale: bool | None = None, decommission_overdue: bool | None = None, missing_ip: bool | None = None) -> Select[tuple[Vm]]`, and `list_vms(db: Session, filters: dict[str, Any], limit: int, offset: int, sort: str | None = None, direction: str = "asc") -> tuple[list[Vm], int]`.
- Keep `FilterOperator`, `SORT_PATTERN`, `SORT_COLUMNS`, `SHUTDOWN_STALE_DAYS`, `template_tag_condition`, `non_template_condition`, `shutdown_since_expr`, `shutdown_stale_condition`, `decommission_overdue_condition`, and `missing_ip_condition` importable from `app.services.vms`.
- Run every project command through Devbox from `/home/tejas/project/InventoryMGR`.
- `backend/tests/` and `docs/` are ignored by `.gitignore`; stage new tests with `git add -f`.
- Do not delete, stage, or rewrite unrelated untracked files.

---

### Task 1: Characterize VM mutations, cloning, filters, and sorting

**Files:**
- Create: `backend/tests/test_vm_service.py`
- Test: `backend/tests/test_vm_service.py`

**Interfaces:**
- Consumes: current `create_vm`, `update_vm`, `clone_vm`, `list_vms`, and `FilterOperator` exports plus restored fixture helpers.
- Produces: three regression tests covering child synchronization, audit values, health recomputation, clone identity/children, relational search, `neq` filtering, counts, and semantic criticality sorting.

- [ ] **Step 1: Create the VM service characterization module**

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Criticality,
    NetworkRole,
    Platform,
    UserRole,
    VmApplication,
    VmNetwork,
)
from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmUpdate
from app.services.vms import FilterOperator, clone_vm, create_vm, list_vms, update_vm

from .conftest import create_user, create_vm_row


def test_create_update_preserve_children_audit_and_health(db_session: Session) -> None:
    editor = create_user(db_session, email="vm-service@example.com", role=UserRole.editor)
    vm = create_vm(
        db_session,
        VmCreate(
            name="service-vm",
            platform="proxmox",
            cluster="pve-a",
            status="running",
            cpu_cores=4,
            memory_mb=8192,
            criticality="high",
            owner="ops",
            disks=[DiskCreate(disk_name="os", size_gb=80)],
            networks=[NetworkCreate(ip_address="10.0.0.5", role="private")],
        ),
        editor,
    )

    assert vm.health_score == 45
    updated = update_vm(
        db_session,
        vm,
        VmUpdate(owner="platform", monitoring_enabled=True, cpu_cores=8),
        editor,
    )

    assert updated.owner == "platform"
    assert updated.monitoring_enabled is True
    assert updated.cpu_cores == 8
    assert updated.health_score == 55
    assert [(disk.disk_name, disk.size_gb) for disk in updated.disks] == [("os", 80)]
    assert [(network.ip_address, network.role.value) for network in updated.networks] == [
        ("10.0.0.5", "private")
    ]
    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.vm_id == vm.id).order_by(AuditLog.field_name)
    ).all()
    assert [(entry.field_name, entry.old_value, entry.new_value) for entry in audits] == [
        ("cpu_cores", "4", "8"),
        ("monitoring_enabled", "False", "True"),
        ("owner", "ops", "platform"),
    ]


def test_clone_preserves_children_resets_identity_and_recomputes_health(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="clone-service@example.com", role=UserRole.editor)
    source = create_vm(
        db_session,
        VmCreate(
            name="clone-source",
            external_id="vm-200",
            platform="vmware",
            cluster="vc-a",
            status="running",
            cpu_cores=2,
            memory_mb=4096,
            criticality="medium",
            owner="ops",
            disks=[DiskCreate(disk_name="os", size_gb=60, storage_name="san-a")],
            networks=[NetworkCreate(ip_address="192.0.2.10", role="public")],
        ),
        editor,
    )

    cloned = clone_vm(db_session, source, editor)

    assert cloned.id != source.id
    assert cloned.name == "clone-source-copy"
    assert cloned.external_id is None
    assert cloned.health_score == source.health_score
    assert [(disk.disk_name, disk.size_gb, disk.storage_name) for disk in cloned.disks] == [
        ("os", 60, "san-a")
    ]
    assert [(network.ip_address, network.role.value) for network in cloned.networks] == [
        ("192.0.2.10", "public")
    ]


def test_list_vms_preserves_search_relations_filters_and_semantic_sort(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="query-service@example.com", role=UserRole.editor)
    critical = create_vm_row(
        db_session,
        editor,
        name="critical-vm",
        platform=Platform.proxmox,
        criticality=Criticality.critical,
        owner="alice",
    )
    high = create_vm_row(
        db_session,
        editor,
        name="high-vm",
        platform=Platform.vmware,
        criticality=Criticality.high,
        owner="bob",
    )
    medium = create_vm_row(
        db_session,
        editor,
        name="medium-vm",
        platform=Platform.proxmox,
        criticality=Criticality.medium,
        owner="carol",
    )
    low = create_vm_row(
        db_session,
        editor,
        name="low-vm",
        platform=Platform.vmware,
        criticality=Criticality.low,
        owner="dave",
    )
    db_session.add(VmApplication(vm_id=high.id, app_name="nginx", app_owner="web"))
    db_session.add(
        VmNetwork(vm_id=high.id, ip_address="198.51.100.20", role=NetworkRole.public)
    )
    db_session.commit()

    searched, searched_total = list_vms(
        db_session,
        {"q": "nginx", "ip_role": [NetworkRole.public]},
        limit=20,
        offset=0,
    )
    assert searched_total == 1
    assert [vm.id for vm in searched] == [high.id]

    non_proxmox, non_proxmox_total = list_vms(
        db_session,
        {"platform": [Platform.proxmox], "platform_op": FilterOperator.neq},
        limit=20,
        offset=0,
        sort="criticality",
        direction="asc",
    )
    assert non_proxmox_total == 2
    assert [vm.id for vm in non_proxmox] == [high.id, low.id]

    ordered, total = list_vms(
        db_session, {}, limit=20, offset=0, sort="criticality", direction="asc"
    )
    assert total == 4
    assert [vm.id for vm in ordered] == [critical.id, high.id, medium.id, low.id]
```

Save the code exactly as `backend/tests/test_vm_service.py`.

- [ ] **Step 2: Run the characterization tests against the unmodified VM service**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vm_service.py -q'
```

Expected: `3 passed`. These tests establish current behavior before either extraction; do not weaken assertions to accommodate a later structural edit.

- [ ] **Step 3: Lint and re-run the focused module**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check tests/test_vm_service.py && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vm_service.py -q'
```

Expected: Ruff passes and pytest reports `3 passed`.

- [ ] **Step 4: Commit the characterization boundary**

```bash
cd /home/tejas/project/InventoryMGR
git add -f backend/tests/test_vm_service.py
git diff --cached --check
git commit -m "test: characterize vm service boundaries"
```

Expected: the commit contains only `backend/tests/test_vm_service.py`.

---

### Task 2: Extract VM mutations behind the existing facade

**Files:**
- Create: `backend/app/services/vm_mutations.py`
- Modify: `backend/app/services/vms.py`
- Test: `backend/tests/test_vm_service.py`
- Test: `backend/tests/test_csv_import_service.py`

**Interfaces:**
- Consumes: Task 1 mutation/clone characterization; current blocks from `IDENTITY_ERROR =` to `def get_vm_or_404` and from `def recompute_health` to `def clone_vm`.
- Produces: `vm_mutations.py` owning `IDENTITY_ERROR`, `create_vm`, `update_vm`, `delete_vm`, `recompute_health`, child replacement, audit writing, and identity-conflict translation; `app.services.vms` re-exports the four public mutation functions with unchanged signatures.

- [ ] **Step 1: Perform the mutation extraction with exact source markers**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from pathlib import Path

service_path = Path("app/services/vms.py")
source = service_path.read_text()
mutation_block = source[
    source.index("IDENTITY_ERROR ="):source.index("def get_vm_or_404")
]
recompute_block = source[
    source.index("def recompute_health"):source.index("def clone_vm")
]
mutation_source = """import uuid
from typing import Any

from fastapi import HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    User,
    Vm,
    VmDisk,
    VmNetwork,
    compute_health_score,
    now_utc,
)
from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmUpdate


""" + mutation_block + recompute_block
Path("app/services/vm_mutations.py").write_text(mutation_source)
source = source.replace(mutation_block, "")
source = source.replace(recompute_block, "")
imports = """from app.services.vm_mutations import (
    IDENTITY_ERROR,
    create_vm,
    delete_vm,
    recompute_health,
    update_vm,
)
"""
source = source.replace(
    "from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmRead, VmUpdate\n",
    "from app.schemas.vms import VmRead\n" + imports,
)
exports = """
__all__ = [
    "IDENTITY_ERROR",
    "SHUTDOWN_STALE_DAYS",
    "SORT_COLUMNS",
    "SORT_PATTERN",
    "FilterOperator",
    "apply_vm_filters",
    "clone_vm",
    "create_vm",
    "decommission_overdue_condition",
    "delete_vm",
    "get_vm_detail_or_404",
    "get_vm_or_404",
    "list_vms",
    "missing_ip_condition",
    "non_template_condition",
    "recompute_health",
    "shutdown_since_expr",
    "shutdown_stale_condition",
    "template_tag_condition",
    "to_vm_read",
    "update_vm",
]

"""
source = source.replace("\n\ndef get_vm_or_404", exports + "def get_vm_or_404", 1)
service_path.write_text(source)
PY'
```

Expected: mutation bodies are copied without semantic edits, `clone_vm` remains in `vms.py`, and the facade declares the full stable public surface in `__all__`.

- [ ] **Step 2: Organize imports and lint the mutation boundary**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check --fix app/services/vms.py app/services/vm_mutations.py tests/test_vm_service.py && uv run ruff check app/services/vms.py app/services/vm_mutations.py tests/test_vm_service.py'
```

Expected: Ruff removes only imports made obsolete by the move and then reports `All checks passed!`.

- [ ] **Step 3: Verify facade imports plus mutation and CSV integration**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from app.services.vms import create_vm, delete_vm, recompute_health, update_vm
from app.services.vm_mutations import (
    create_vm as extracted_create_vm,
    delete_vm as extracted_delete_vm,
    recompute_health as extracted_recompute_health,
    update_vm as extracted_update_vm,
)

assert create_vm is extracted_create_vm
assert update_vm is extracted_update_vm
assert delete_vm is extracted_delete_vm
assert recompute_health is extracted_recompute_health
PY
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vm_service.py tests/test_csv_import_service.py -q'
```

Expected: facade identity assertions pass and pytest reports `6 passed`.

- [ ] **Step 4: Run the complete backend gate after the first extraction**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q'
```

Expected: Ruff passes and pytest reports `17 passed`.

- [ ] **Step 5: Commit the independently reversible mutation extraction**

```bash
cd /home/tejas/project/InventoryMGR
git add backend/app/services/vms.py backend/app/services/vm_mutations.py
git diff --cached --check
git commit -m "refactor: extract vm mutations"
```

Expected: the commit contains only the facade edit and new mutation module.

---

### Task 3: Extract VM filters, alert predicates, sorting, and pagination

**Files:**
- Create: `backend/app/services/vm_filters.py`
- Modify: `backend/app/services/vms.py`
- Test: `backend/tests/test_vm_service.py`
- Test: `backend/tests/test_csv_import_service.py`

**Interfaces:**
- Consumes: Task 1 query characterization and Task 2's facade `__all__`; the current contiguous block from `class FilterOperator` through the end of `vms.py`.
- Produces: `vm_filters.py` owning `FilterOperator`, filter helpers, alert predicates, `apply_vm_filters`, sort constants, and `list_vms`; the facade re-exports all names listed in Global Constraints while retaining detail loaders, serialization, and clone orchestration locally.

- [ ] **Step 1: Perform the query extraction with exact source markers**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from pathlib import Path

service_path = Path("app/services/vms.py")
source = service_path.read_text()
filter_block = source[source.index("class FilterOperator"):]
filter_source = """from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import Select, String, and_, case, cast, exists, func, literal_column, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    Criticality,
    Environment,
    NetworkRole,
    OsFamily,
    Platform,
    Vm,
    VmApplication,
    VmNetwork,
    VmStatus,
)


""" + filter_block
Path("app/services/vm_filters.py").write_text(filter_source)
source = source.replace(filter_block, "")
imports = """from app.services.vm_filters import (
    SHUTDOWN_STALE_DAYS,
    SORT_COLUMNS,
    SORT_PATTERN,
    FilterOperator,
    apply_vm_filters,
    decommission_overdue_condition,
    list_vms,
    missing_ip_condition,
    non_template_condition,
    shutdown_since_expr,
    shutdown_stale_condition,
    template_tag_condition,
)
"""
source = source.replace("from app.services.vm_mutations import (", imports + "from app.services.vm_mutations import (")
service_path.write_text(source)
PY'
```

Expected: `vm_filters.py` receives the query block unchanged and `vms.py` imports each externally used query symbol for compatibility.

- [ ] **Step 2: Organize imports and lint all VM service modules**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check --fix app/services/vms.py app/services/vm_filters.py app/services/vm_mutations.py tests/test_vm_service.py && uv run ruff check app/services/vms.py app/services/vm_filters.py app/services/vm_mutations.py tests/test_vm_service.py'
```

Expected: Ruff removes imports made obsolete by the move and then reports `All checks passed!`.

- [ ] **Step 3: Verify route-facing facade identity and focused behavior**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run python - <<'"'"'PY'"'"'
from app.services.vm_filters import (
    FilterOperator as ExtractedFilterOperator,
    apply_vm_filters as extracted_apply_vm_filters,
    list_vms as extracted_list_vms,
    shutdown_stale_condition as extracted_shutdown_stale_condition,
)
from app.services.vms import (
    FilterOperator,
    apply_vm_filters,
    list_vms,
    shutdown_stale_condition,
)

assert FilterOperator is ExtractedFilterOperator
assert apply_vm_filters is extracted_apply_vm_filters
assert list_vms is extracted_list_vms
assert shutdown_stale_condition is extracted_shutdown_stale_condition
PY
APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest tests/test_vm_service.py tests/test_csv_import_service.py -q'
```

Expected: facade identity assertions pass and pytest reports `6 passed`.

- [ ] **Step 4: Run the complete backend phase gate**

Run:

```bash
cd /home/tejas/project/InventoryMGR
devbox run -- bash -lc 'cd backend && uv run ruff check app tests && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q'
```

Expected: Ruff passes and pytest reports `17 passed`; any failure blocks completion and must be repaired or this extraction reverted. No migration/schema command is needed because this plan changes no models or migrations.

- [ ] **Step 5: Commit the independently reversible query extraction**

```bash
cd /home/tejas/project/InventoryMGR
git add backend/app/services/vms.py backend/app/services/vm_filters.py
git diff --cached --check
git commit -m "refactor: extract vm filters"
```

Expected: the commit contains exactly the facade edit and new filter module; no route, schema, model, migration, frontend, or test assertion changes are staged.
