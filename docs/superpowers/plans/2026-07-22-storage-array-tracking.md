# Storage Array Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add documentation-only tracking of Synology/NetApp storage arrays — capacity/usage, iSCSI LUNs (linked to hypervisor clusters), and NFS shares — as a new top-level entity with a three-level hierarchy (Array → Volume → LUN/Share).

**Architecture:** Mirror the existing `Vm → disks/networks` parent-child pattern. Four new tables, one new `storage_vendor` enum, a new `cluster` dropdown category. Used% and threshold flags are computed on read (no denormalized column, unlike VM `health_score`). Backend follows the route/service/schema split; frontend follows the thin-shell + `api/client.ts` pattern.

**Tech Stack:** FastAPI, SQLAlchemy 2 (`Mapped`), Alembic, Pydantic v2, Postgres (real DB in tests); Next.js/React, TypeScript strict, Vitest.

Spec: `docs/superpowers/specs/2026-07-21-storage-array-tracking-design.md`

## Global Constraints

- **Every state-changing route MUST take `Csrf`** (aliases from `api/deps.py`). Omitting it silently disables CSRF.
- RBAC via typed aliases: `ViewerUser` (read), `EditorUser` (write). No admin gate on storage CRUD (matches VM disks/networks; delete-array uses `EditorUser`, not `AdminUser`, since these are child-heavy but low-blast-radius docs — confirm during review).
- Enums are Python `StrEnum` in `db/models.py`; any new enum/value needs an Alembic migration.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Backend tests hit **real Postgres** via `backend/tests/conftest.py` (helpers: `create_user`, `login` → CSRF, `auth_headers`). Reset per-test.
- Frontend: all HTTP through `frontend/src/api/client.ts`; Vitest 80% coverage on lines/statements/functions/branches; pages under `src/app/**` are thin shells re-exporting `src/routes/*.tsx`.
- Deliberate corner-cuts get a `ponytail:` comment.
- Run `just verify` before any PR.

---

## Task 1: Models + enum + migration

**Files:**
- Modify: `backend/app/db/models.py` (add `StorageVendor` enum, `cluster` to `DropdownCategory`, four models)
- Create: `backend/alembic/versions/0014_storage_arrays.py`
- Test: `backend/tests/test_storage_models.py`

**Interfaces:**
- Produces: `StorageArray`, `StorageVolume`, `StorageLun`, `StorageNfsShare` ORM models; `StorageVendor` enum; `DropdownCategory.cluster`.

- [ ] **Step 1: Write failing test** — `backend/tests/test_storage_models.py`

```python
from app.db.models import (
    DropdownCategory, StorageArray, StorageLun, StorageNfsShare, StorageVendor, StorageVolume, User, UserRole,
)
from app.core.security import hash_password


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u); db.commit(); db.refresh(u); return u


def test_cluster_is_a_dropdown_category():
    assert DropdownCategory.cluster.value == "cluster"


def test_array_cascades_to_children(db_session):
    u = _user(db_session)
    a = StorageArray(name="syn-01", vendor=StorageVendor.synology, total_capacity_gb=1000,
                     used_capacity_gb=400, created_by_id=u.id, updated_by_id=u.id)
    db_session.add(a); db_session.flush()
    v = StorageVolume(array_id=a.id, name="vol1", capacity_gb=500, used_gb=250)
    db_session.add(v); db_session.flush()
    db_session.add(StorageLun(volume_id=v.id, name="lun0", size_gb=100, cluster="pve-cluster-a"))
    db_session.add(StorageNfsShare(volume_id=v.id, export_path="/vol1/share"))
    db_session.commit()
    db_session.delete(a); db_session.commit()
    assert db_session.query(StorageVolume).count() == 0
    assert db_session.query(StorageLun).count() == 0
    assert db_session.query(StorageNfsShare).count() == 0
```

- [ ] **Step 2: Run — expect fail** `pytest backend/tests/test_storage_models.py -v` → ImportError.

- [ ] **Step 3: Add enum + category to `db/models.py`**

Add value to existing `DropdownCategory`:
```python
class DropdownCategory(StrEnum):
    cpu = "cpu"
    datacenter = "datacenter"
    disk = "disk"
    os = "os"
    cluster = "cluster"
```
New vendor enum (near other StrEnums):
```python
class StorageVendor(StrEnum):
    synology = "synology"
    netapp = "netapp"
```

- [ ] **Step 4: Add four models** (end of `db/models.py`). Children carry `sort_order`, cascade delete like `VmDisk`.

```python
class StorageArray(Base, TimestampMixin):
    __tablename__ = "storage_arrays"
    __table_args__ = (CheckConstraint("length(btrim(name)) > 0", name="ck_storage_arrays_name_nonempty"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor: Mapped[StorageVendor] = mapped_column(Enum(StorageVendor, name="storage_vendor"), nullable=False)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mgmt_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    datacenter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_capacity_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_capacity_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    volumes: Mapped[list["StorageVolume"]] = relationship(
        back_populates="array", cascade="all, delete-orphan", order_by="StorageVolume.sort_order")


class StorageVolume(Base):
    __tablename__ = "storage_volumes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    array_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("storage_arrays.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    capacity_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    array: Mapped[StorageArray] = relationship(back_populates="volumes")
    luns: Mapped[list["StorageLun"]] = relationship(
        back_populates="volume", cascade="all, delete-orphan", order_by="StorageLun.sort_order")
    shares: Mapped[list["StorageNfsShare"]] = relationship(
        back_populates="volume", cascade="all, delete-orphan", order_by="StorageNfsShare.sort_order")


class StorageLun(Base):
    __tablename__ = "storage_luns"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    volume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("storage_volumes.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    size_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_iqn: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cluster: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    volume: Mapped[StorageVolume] = relationship(back_populates="luns")


class StorageNfsShare(Base):
    __tablename__ = "storage_nfs_shares"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    volume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("storage_volumes.id", ondelete="CASCADE"), nullable=False)
    export_path: Mapped[str] = mapped_column(String(500), nullable=False)
    used_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    allowed_clients: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    volume: Mapped[StorageVolume] = relationship(back_populates="shares")
```

- [ ] **Step 5: Create migration** `backend/alembic/versions/0014_storage_arrays.py`

**Gotcha:** `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that then references the new value, so add the `cluster` enum value inside an `autocommit_block()` before seeding options.

```python
"""Storage arrays + volumes + luns + nfs shares; cluster dropdown category; storage warn pct.

Revision ID: 0014
Revises: 0013
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

storage_vendor = sa.Enum("synology", "netapp", name="storage_vendor")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE dropdown_category ADD VALUE IF NOT EXISTS 'cluster'")

    storage_vendor.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "storage_arrays",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("vendor", storage_vendor, nullable=False),
        sa.Column("model", sa.String(255)),
        sa.Column("mgmt_host", sa.String(255)),
        sa.Column("datacenter", sa.String(255)),
        sa.Column("description", sa.Text()),
        sa.Column("total_capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_storage_arrays_name_nonempty"),
    )
    op.create_table(
        "storage_volumes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("array_id", UUID(as_uuid=True), sa.ForeignKey("storage_arrays.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "storage_luns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("volume_id", UUID(as_uuid=True), sa.ForeignKey("storage_volumes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_gb", sa.Integer()),
        sa.Column("target_iqn", sa.String(255)),
        sa.Column("cluster", sa.String(255)),
        sa.Column("status", sa.String(100)),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "storage_nfs_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("volume_id", UUID(as_uuid=True), sa.ForeignKey("storage_volumes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("export_path", sa.String(500), nullable=False),
        sa.Column("used_gb", sa.Integer()),
        sa.Column("allowed_clients", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    # Seed cluster dropdown from existing distinct VM clusters + the storage warn-pct setting.
    op.execute(
        "INSERT INTO dropdown_options (id, category, value, created_at, updated_at) "
        "SELECT gen_random_uuid(), 'cluster', cluster, now(), now() "
        "FROM (SELECT DISTINCT cluster FROM vms WHERE cluster IS NOT NULL) s"
    )
    op.execute("INSERT INTO app_settings (key, value) VALUES ('storage_usage_warn_pct', '85')")


def downgrade() -> None:
    op.drop_table("storage_nfs_shares")
    op.drop_table("storage_luns")
    op.drop_table("storage_volumes")
    op.drop_table("storage_arrays")
    storage_vendor.drop(op.get_bind(), checkfirst=True)
    op.execute("DELETE FROM app_settings WHERE key = 'storage_usage_warn_pct'")
    op.execute("DELETE FROM dropdown_options WHERE category = 'cluster'")
    # ponytail: leaving the 'cluster' enum value in place — Postgres cannot DROP an enum value.
```

- [ ] **Step 6: Run — expect pass** `pytest backend/tests/test_storage_models.py -v`
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(storage): models, enum, migration for array/volume/lun/share"`

---

## Task 2: Schemas

**Files:**
- Create: `backend/app/schemas/storage.py`
- Modify: `backend/app/schemas/settings.py` (add `cluster` field to `GroupedDropdownOptions`; add `storage_usage_warn_pct` to app settings schemas)
- Test: covered via Task 4 route tests.

**Interfaces:**
- Produces: `ArrayCreate/Update`, `VolumeCreate/Update/Read`, `LunCreate/Update/Read`, `ShareCreate/Update/Read`, `ArrayListItem`, `ArrayDetail` (nested), `VolumeDetail`, usage fields `used_pct: float | None`, `over_threshold: bool`.

- [ ] **Step 1: Create `schemas/storage.py`** — one create/update/read triple per entity, mirroring `DiskCreate/DiskUpdate/DiskRead`. Reads use `from_attributes=True`. Array/volume detail include computed usage.

```python
import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.db.models import StorageVendor


class LunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size_gb: int = Field(default=0, ge=0)
    used_gb: int | None = Field(default=None, ge=0)
    target_iqn: str | None = None
    cluster: str | None = None
    status: str | None = None
    sort_order: int = 0

class LunUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    size_gb: int | None = Field(default=None, ge=0)
    used_gb: int | None = Field(default=None, ge=0)
    target_iqn: str | None = None
    cluster: str | None = None
    status: str | None = None
    sort_order: int | None = None

class LunRead(LunCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    volume_id: uuid.UUID

# ShareCreate/ShareUpdate/ShareRead — same triple; fields: export_path(req, min_length=1), used_gb, allowed_clients, notes, sort_order.
# VolumeCreate/VolumeUpdate/VolumeRead — fields: name(req), capacity_gb, used_gb, notes, sort_order.

class VolumeDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    array_id: uuid.UUID
    name: str
    capacity_gb: int
    used_gb: int
    notes: str | None
    sort_order: int
    used_pct: float | None
    over_threshold: bool
    luns: list[LunRead]
    shares: list["ShareRead"]

class ArrayCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    vendor: StorageVendor
    model: str | None = None
    mgmt_host: str | None = None
    datacenter: str | None = None
    description: str | None = None
    total_capacity_gb: int = Field(default=0, ge=0)
    used_capacity_gb: int = Field(default=0, ge=0)
    notes: str | None = None

class ArrayUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    vendor: StorageVendor | None = None
    model: str | None = None
    mgmt_host: str | None = None
    datacenter: str | None = None
    description: str | None = None
    total_capacity_gb: int | None = Field(default=None, ge=0)
    used_capacity_gb: int | None = Field(default=None, ge=0)
    notes: str | None = None

class ArrayListItem(BaseModel):
    id: uuid.UUID
    name: str
    vendor: StorageVendor
    datacenter: str | None
    total_capacity_gb: int
    used_capacity_gb: int
    used_pct: float | None
    over_threshold: bool
    volume_count: int
    lun_count: int
    share_count: int

class ArrayDetail(BaseModel):
    id: uuid.UUID
    name: str
    vendor: StorageVendor
    model: str | None
    mgmt_host: str | None
    datacenter: str | None
    description: str | None
    total_capacity_gb: int
    used_capacity_gb: int
    notes: str | None
    used_pct: float | None
    over_threshold: bool
    volumes: list[VolumeDetail]
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 2: Extend `schemas/settings.py`** — add `cluster: list[str] = Field(default_factory=list)` to `GroupedDropdownOptions`; add `storage_usage_warn_pct: int` to `AppSettingsRead`; in `AppSettingsUpdate` make both fields optional: `decommission_notify_days: int | None = Field(default=None, ge=1, le=3650)` and `storage_usage_warn_pct: int | None = Field(default=None, ge=1, le=100)`.
- [ ] **Step 3: Commit** `git commit -am "feat(storage): pydantic schemas + settings additions"`

---

## Task 3: Service layer + usage computation

**Files:**
- Create: `backend/app/services/storage.py`
- Modify: `backend/app/services/app_settings.py` (add `get_warn_pct`/`set_warn_pct`)
- Test: `backend/tests/test_storage_usage.py`

**Interfaces:**
- Consumes: `AppSetting`, storage models, storage schemas.
- Produces: `get_array_or_404(db, id)`, `get_array_detail_or_404(db, id)`, `create_array(db, payload, user)`, `update_array(db, array, payload, user)`, `delete_array(db, array)`, `list_arrays(db) -> list[ArrayListItem]`, `compute_pct(used, capacity) -> float | None`, `to_array_detail(array, warn_pct) -> ArrayDetail`. `app_settings.get_warn_pct(db) -> int` (default 85), `set_warn_pct(db, pct)`.

- [ ] **Step 1: Failing test** `backend/tests/test_storage_usage.py`

```python
from app.services.storage import compute_pct


def test_compute_pct_basic():
    assert compute_pct(400, 1000) == 40.0

def test_compute_pct_zero_capacity_is_none():
    assert compute_pct(0, 0) is None  # ponytail: undefined usage, not a div-by-zero crash
```

- [ ] **Step 2: Run — expect fail** (module missing).
- [ ] **Step 3: Add to `app_settings.py`**

```python
WARN_PCT_KEY = "storage_usage_warn_pct"
DEFAULT_WARN_PCT = 85

def get_warn_pct(db: Session) -> int:
    row = db.get(AppSetting, WARN_PCT_KEY)
    if row is None:
        return DEFAULT_WARN_PCT
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_WARN_PCT

def set_warn_pct(db: Session, pct: int) -> int:
    row = db.get(AppSetting, WARN_PCT_KEY)
    if row is None:
        db.add(AppSetting(key=WARN_PCT_KEY, value=str(pct)))
    else:
        row.value = str(pct)
    db.commit()
    return pct
```

- [ ] **Step 4: Create `services/storage.py`** — CRUD (set `created_by_id`/`updated_by_id` from `user` on create; `updated_by_id` on update), `selectinload(StorageArray.volumes).selectinload(StorageVolume.luns)` + `.shares` for detail, mappers folding in usage. No audit rows, no health recompute.

```python
def compute_pct(used: int, capacity: int) -> float | None:
    if not capacity:
        return None
    return round(used / capacity * 100, 1)

def _over(used: int, capacity: int, warn_pct: int) -> bool:
    pct = compute_pct(used, capacity)
    return pct is not None and pct >= warn_pct

def to_array_detail(array: StorageArray, warn_pct: int) -> ArrayDetail:
    volumes = [
        VolumeDetail(
            **{c.name: getattr(v, c.name) for c in StorageVolume.__table__.columns},
            luns=[LunRead.model_validate(l) for l in v.luns],
            shares=[ShareRead.model_validate(s) for s in v.shares],
            used_pct=compute_pct(v.used_gb, v.capacity_gb),
            over_threshold=_over(v.used_gb, v.capacity_gb, warn_pct),
        )
        for v in array.volumes
    ]
    return ArrayDetail(
        **{c.name: getattr(array, c.name) for c in StorageArray.__table__.columns},
        used_pct=compute_pct(array.used_capacity_gb, array.total_capacity_gb),
        over_threshold=_over(array.used_capacity_gb, array.total_capacity_gb, warn_pct),
        volumes=volumes,
    )
```

`list_arrays` eager-loads volumes→luns/shares, then builds `ArrayListItem`s with Python-side counts (arrays are few) and threshold from `get_warn_pct`.

- [ ] **Step 5: Run — expect pass.**
- [ ] **Step 6: Commit** `git commit -am "feat(storage): service layer + usage/threshold computation"`

---

## Task 4: Routes (array CRUD + child subrouters) + wiring

**Files:**
- Create: `backend/app/api/routes/storage.py` (array routes + a `make_storage_subrouter` factory for volume/lun/share)
- Modify: `backend/app/main.py` (include routers); `backend/app/api/routes/settings.py` (extend `/options` + `/app`)
- Test: `backend/tests/test_storage_api.py`, `backend/tests/test_auth_rbac_storage.py`

**Interfaces:**
- Consumes: Task 3 service, Task 2 schemas, `deps.py` aliases.
- Produces: REST surface under `/api/storage/...`.

The VM subrouter factory (`_vm_subrouter.py`) is hard-bound to `vm_id` + `recompute_health`, so it can't be reused directly. Write a parallel `make_storage_subrouter(*, model, parent_id_param, parent_model, create_schema, update_schema, read_schema, not_found_detail)` in `storage.py`, same list/add/patch/delete shape minus health recompute, keyed on the parent id path param (validate parent exists → 404). Mount volumes under array, luns+shares under volume.

- [ ] **Step 1: Failing test** `backend/tests/test_storage_api.py`

```python
from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login


def _mk(client, db, role=UserRole.editor):
    create_user(db, email="s@x.io", role=role)
    return login(client, "s@x.io")


def test_create_and_detail(client, db_session):
    csrf = _mk(client, db_session)
    r = client.post("/api/storage/arrays", headers=auth_headers(csrf), json={
        "name": "syn-01", "vendor": "synology", "total_capacity_gb": 1000, "used_capacity_gb": 850})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    d = client.get(f"/api/storage/arrays/{aid}").json()
    assert d["used_pct"] == 85.0 and d["over_threshold"] is True
```

- [ ] **Step 2: Run — expect fail (404 route).**
- [ ] **Step 3: Implement `routes/storage.py`.** Array endpoints mirror `vms.py`:
  - `GET /arrays` → `list[ArrayListItem]` (`ViewerUser`)
  - `POST /arrays` → `ArrayDetail` 201 (`EditorUser`, `Csrf`)
  - `GET /arrays/{id}` → `ArrayDetail` (`ViewerUser`)
  - `PATCH /arrays/{id}` (`EditorUser`, `Csrf`)
  - `DELETE /arrays/{id}` 204 (`EditorUser`, `Csrf`)
  - Child subrouters via factory: `volumes_router`, `luns_router`, `shares_router`.

- [ ] **Step 4: Wire `main.py`**

```python
from app.api.routes.storage import router as storage_router, volumes_router, luns_router, shares_router
...
app.include_router(storage_router, prefix="/api/storage", tags=["storage"])
app.include_router(volumes_router, prefix="/api/storage/arrays/{array_id}/volumes", tags=["storage"])
app.include_router(luns_router, prefix="/api/storage/volumes/{volume_id}/luns", tags=["storage"])
app.include_router(shares_router, prefix="/api/storage/volumes/{volume_id}/shares", tags=["storage"])
```

- [ ] **Step 5: Extend `settings.py`** — `list_options` return adds `cluster=grouped["cluster"]` (the grouped dict already keys every `DropdownCategory`). `get_app_settings` returns `storage_usage_warn_pct=app_settings.get_warn_pct(db)`; `update_app_settings` sets only fields present in payload (`if payload.decommission_notify_days is not None: ...`, `if payload.storage_usage_warn_pct is not None: app_settings.set_warn_pct(...)`).
- [ ] **Step 6: RBAC/CSRF test** `test_auth_rbac_storage.py` — viewer POST → 403; editor POST without `X-CSRF-Token` → 403; unauth GET → 401. Mirror `test_app_settings.py`.
- [ ] **Step 7: Run — expect pass.** `pytest backend/tests/test_storage_api.py backend/tests/test_auth_rbac_storage.py -v`
- [ ] **Step 8: Commit** `git commit -am "feat(storage): array + child routes, settings wiring"`

---

## Task 5: Frontend API client (types + methods)

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts` (mirror existing client tests)

**Interfaces:**
- Produces: `StorageArray`, `StorageArrayListItem`, `StorageVolume`, `Lun`, `NfsShare`, `StorageVendor` types; `api.listArrays/getArray/createArray/updateArray/deleteArray` + child add/delete; `cluster` on `DropdownCategory`/`DropdownOptions`; `storage_usage_warn_pct` on `AppSettings`.

- [ ] **Step 1: Failing test** — assert `api.listArrays` hits `/api/storage/arrays`, `api.createArray` POSTs (mock fetch, existing style).
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Add types + methods**

```typescript
export type StorageVendor = 'synology' | 'netapp';
export type DropdownCategory = 'cpu' | 'datacenter' | 'disk' | 'os' | 'cluster';
// DropdownOptions gains: cluster: string[];
// AppSettings gains: storage_usage_warn_pct: number;

export interface Lun { id: string; volume_id: string; name: string; size_gb: number; used_gb: number | null; target_iqn: string | null; cluster: string | null; status: string | null; sort_order: number; }
export interface NfsShare { id: string; volume_id: string; export_path: string; used_gb: number | null; allowed_clients: string | null; notes: string | null; sort_order: number; }
export interface StorageVolume { id: string; array_id: string; name: string; capacity_gb: number; used_gb: number; notes: string | null; sort_order: number; used_pct: number | null; over_threshold: boolean; luns: Lun[]; shares: NfsShare[]; }
export interface StorageArray { id: string; name: string; vendor: StorageVendor; model: string | null; mgmt_host: string | null; datacenter: string | null; description: string | null; total_capacity_gb: number; used_capacity_gb: number; notes: string | null; used_pct: number | null; over_threshold: boolean; volumes: StorageVolume[]; created_at: string; updated_at: string; }
export interface StorageArrayListItem { id: string; name: string; vendor: StorageVendor; datacenter: string | null; total_capacity_gb: number; used_capacity_gb: number; used_pct: number | null; over_threshold: boolean; volume_count: number; lun_count: number; share_count: number; }
```

Add to the `api` object (mirroring `listVms`/`addDisk`/`deleteDisk`): `listArrays`, `getArray`, `createArray`, `updateArray`, `deleteArray`, `addVolume`/`deleteVolume`, `addLun`/`deleteLun`, `addShare`/`deleteShare`. Change `updateAppSettings` to accept a partial: `(patch: { decommission_notify_days?: number; storage_usage_warn_pct?: number })` — update the one existing caller in `SettingsPage.tsx` accordingly.

- [ ] **Step 4: Run — expect pass.** `cd frontend && npx vitest run src/api/client.test.ts`
- [ ] **Step 5: Commit** `git commit -am "feat(web): storage api client types + methods"`

---

## Task 6: Storage list page + nav

**Files:**
- Create: `frontend/src/routes/StoragePage.tsx`; `frontend/src/app/(app)/storage/page.tsx` (thin shell); `frontend/src/routes/StoragePage.test.tsx`
- Modify: `frontend/src/components/AppNav.tsx` (nav item)

- [ ] **Step 1: Failing test** — render `StoragePage` with mocked `api.listArrays` → shows array name, used% bar, red badge when `over_threshold`.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Build page** — `useQuery(['arrays'], api.listArrays)`; table/cards of `StorageArrayListItem`s; used% bar; `over_threshold` badge; rows link to `/storage/{id}`. Add nav entry to `buildNavItems`: `{ to: '/storage', label: 'Storage', visible: true, icon: <IconStorage /> }` with a small `IconStorage` svg following the existing icon components in `AppNav.tsx`.
- [ ] **Step 4: Thin shell** `app/(app)/storage/page.tsx` re-exports `StoragePage` (pattern: `app/(app)/inventory/page.tsx`).
- [ ] **Step 5: Run — expect pass; coverage ≥80% for the route.**
- [ ] **Step 6: Commit** `git commit -am "feat(web): storage list page + nav"`

---

## Task 7: Storage detail page (volumes → LUNs/shares panels)

**Files:**
- Create: `frontend/src/routes/StorageDetailPage.tsx`; `frontend/src/app/(app)/storage/[id]/page.tsx`; `frontend/src/routes/StorageDetailPage.test.tsx`

- [ ] **Step 1: Failing test** — mock `api.getArray`; assert array header (used%), a volume panel, its LUN + NFS-share rows render; adding a LUN calls `api.addLun`.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Build page** — array header card (capacity/used%/threshold); volume panels each with a LUN sub-table and an NFS-share sub-table + inline add/delete, mirroring the disks/networks panels in `VmDetailPage.tsx`. LUN `cluster` field = `<select>` from `api.getDropdownOptions().cluster`. Invalidate `['arrays']` and `['array', id]` on mutations.
- [ ] **Step 4: Thin shell** for `[id]/page.tsx`.
- [ ] **Step 5: Run — expect pass; coverage ≥80%.**
- [ ] **Step 6: Commit** `git commit -am "feat(web): storage detail page with volume/lun/share panels"`

---

## Task 8: Settings field + dashboard card

**Files:**
- Modify: `frontend/src/routes/SettingsPage.tsx` (+ test) — add a `storage_usage_warn_pct` numeric field beside the decommission notify-days field; save via `api.updateAppSettings({ storage_usage_warn_pct })`.
- Modify: `frontend/src/routes/DashboardPage.tsx` (+ test) — add a small card: count of arrays over threshold (from `api.listArrays`), links to `/storage`.

- [ ] **Step 1: Failing tests** for both (field renders + patches; dashboard card shows over-threshold count).
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement both.**
- [ ] **Step 4: Run — expect pass; coverage ≥80%.**
- [ ] **Step 5: Commit** `git commit -am "feat(web): storage warn-pct setting + dashboard card"`

---

## Task 9: Full verify + docs

- [ ] **Step 1:** `graphify update .` (refresh graph after edits).
- [ ] **Step 2:** `just verify` (full gate: ruff, type check, pytest real-PG, vitest 80%, tsc). Fix anything red.
- [ ] **Step 3:** Update `CLAUDE.md` Database section — note the new `StorageVendor` enum and `cluster` dropdown category (one line each).
- [ ] **Step 4: Commit** `git commit -am "chore(storage): verify gate + docs"` and open PR.

---

## Verification (end-to-end)

1. **Migration:** `cd backend && alembic upgrade head` on prod-like data — confirm `cluster` options seeded from existing VM clusters, `storage_usage_warn_pct=85` present, four tables created.
2. **API smoke:** create array `used=850/1000`, add volume + LUN (cluster from dropdown) + NFS share; `GET /api/storage/arrays/{id}` → `used_pct=85.0`, `over_threshold=true`; delete array → children gone.
3. **RBAC/CSRF:** viewer POST → 403; editor POST w/o `X-CSRF-Token` → 403.
4. **UI (playwright MCP or dev server):** Storage nav → list shows red badge on the 85% array → detail shows volume panel with LUN/share tables → Settings warn pct → 90 → badge clears → Dashboard card count updates.
5. `just verify` green.

## Spec coverage self-check

Three-level Array/Volume/LUN/Share model ✓ (T1) · vendor enum ✓ (T1) · cluster dropdown seeded ✓ (T1) · used%+threshold computed on read ✓ (T3) · global warn-pct AppSetting ✓ (T1/T3) · array+volume threshold flag ✓ (T3) · REST + CSRF + RBAC ✓ (T4) · list/detail nesting ✓ (T2/T4) · client ✓ (T5) · list page ✓ (T6) · detail panels ✓ (T7) · settings field ✓ (T8) · dashboard card ✓ (T8) · out-of-scope (no CSV/polling/history/audit) ✓.
