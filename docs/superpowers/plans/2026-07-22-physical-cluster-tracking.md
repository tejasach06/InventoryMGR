# Physical Cluster Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add documentation-only tracking of physical server clusters and their nodes — hardware specs (CPU/RAM/storage), IP addresses, physical location (datacenter/rack/U) — as a new top-level entity with a two-level hierarchy (Cluster → Nodes). No VM linkage in v1.

**Architecture:** Mirror the existing `StorageArray → StorageVolume` parent-child pattern exactly: two SQLAlchemy tables, a service module for CRUD + `to_*` mappers, routes that reuse the `make_storage_subrouter`-style factory for the nested nodes collection, a thin Pydantic schema layer, and a frontend list+detail page pair following `StoragePage`/`StorageDetailPage`. Deviates from the original spec's "PUT" node endpoints — this plan uses **PATCH with `exclude_unset=True`** partial updates, consistent with every other update route in the codebase (storage arrays, VM children, settings), so the existing subrouter factory pattern can be reused almost verbatim.

**Tech Stack:** FastAPI, SQLAlchemy 2 (`Mapped`), Alembic, Pydantic v2, Postgres (real DB in tests); Next.js/React, TypeScript strict, Vitest.

Spec: `docs/superpowers/specs/2026-07-22-physical-cluster-tracking-design.md`

## Global Constraints

- **Every state-changing route MUST take `Csrf`** (aliases from `api/deps.py`). Omitting it silently disables CSRF.
- RBAC via typed aliases: `ViewerUser` (read), `EditorUser` (write). No admin gate on cluster CRUD (matches storage arrays).
- Enums are Python `StrEnum` in `db/models.py`; this feature adds no new enum.
- ruff: line length 100, rules E/F/I/UP/B. TypeScript strict.
- Backend tests hit **real Postgres** via `backend/tests/conftest.py` (helpers: `create_user`, `login` → CSRF, `auth_headers`). Reset per-test.
- Frontend: all HTTP through `frontend/src/api/client.ts`; Vitest 80% coverage on lines/statements/functions/branches; pages under `src/app/**` are thin shells re-exporting `src/routes/*.tsx`.
- Deliberate corner-cuts get a `ponytail:` comment.
- Update semantics: PATCH + `exclude_unset=True` on both cluster and node update endpoints (spec said PUT; overridden per codebase convention — confirmed with user).
- Run `just verify` before any PR.

---

## Task 1: Models + migration

**Files:**
- Modify: `backend/app/db/models.py` (append after `StorageNfsShare`, ~line 511)
- Create: `backend/alembic/versions/0015_physical_clusters.py`
- Test: `backend/tests/test_cluster_models.py`

**Interfaces:**
- Consumes: `Base`, `TimestampMixin`, `now_utc`, `JSONB`, `UUID` (all already imported in `models.py`).
- Produces: `PhysicalCluster` (`id`, `name`, `description`, `notes`, `created_by_id`, `updated_by_id`, `created_at`, `updated_at`, `nodes` relationship) and `PhysicalNode` (`id`, `cluster_id`, `name`, `cpu_model`, `cpu_cores`, `cpu_threads`, `ram_total_gb`, `ram_used_gb`, `storage_usable_gb`, `datacenter`, `rack`, `rack_unit`, `ip_addresses`, `notes`, `sort_order`) — both importable from `app.db.models`.

- [ ] **Step 1: Write failing test** — `backend/tests/test_cluster_models.py`

```python
from app.core.security import hash_password
from app.db.models import PhysicalCluster, PhysicalNode, User, UserRole


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_cluster_cascades_to_nodes(db_session):
    u = _user(db_session)
    c = PhysicalCluster(name="pve-cluster-a", created_by_id=u.id, updated_by_id=u.id)
    db_session.add(c)
    db_session.flush()
    db_session.add(
        PhysicalNode(
            cluster_id=c.id,
            name="node-01",
            cpu_cores=16,
            cpu_threads=32,
            ram_total_gb=128,
            storage_usable_gb=2000,
            ip_addresses=[{"label": "mgmt", "address": "10.0.1.5"}],
        )
    )
    db_session.commit()
    db_session.delete(c)
    db_session.commit()
    assert db_session.query(PhysicalNode).count() == 0


def test_node_ip_addresses_default_empty_list(db_session):
    u = _user(db_session)
    c = PhysicalCluster(name="pve-cluster-b", created_by_id=u.id, updated_by_id=u.id)
    db_session.add(c)
    db_session.flush()
    n = PhysicalNode(cluster_id=c.id, name="node-01")
    db_session.add(n)
    db_session.commit()
    db_session.refresh(n)
    assert n.ip_addresses == []
    assert n.cpu_cores == 0 and n.cpu_threads == 0 and n.ram_total_gb == 0 and n.storage_usable_gb == 0
```

- [ ] **Step 2: Run — expect fail** `pytest backend/tests/test_cluster_models.py -v` → `ImportError: cannot import name 'PhysicalCluster'`.

- [ ] **Step 3: Add models** — append to `backend/app/db/models.py` after the `StorageNfsShare` class (end of file, after line 511):

```python
class PhysicalCluster(Base, TimestampMixin):
    __tablename__ = "physical_clusters"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="ck_physical_clusters_name_nonempty"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    updated_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    nodes: Mapped[list["PhysicalNode"]] = relationship(
        back_populates="cluster",
        cascade="all, delete-orphan",
        order_by="PhysicalNode.sort_order",
    )


class PhysicalNode(Base):
    __tablename__ = "physical_nodes"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="ck_physical_nodes_name_nonempty"),
        CheckConstraint("cpu_cores >= 0", name="ck_physical_nodes_cpu_cores_nonnegative"),
        CheckConstraint("cpu_threads >= 0", name="ck_physical_nodes_cpu_threads_nonnegative"),
        CheckConstraint("ram_total_gb >= 0", name="ck_physical_nodes_ram_total_nonnegative"),
        CheckConstraint("storage_usable_gb >= 0", name="ck_physical_nodes_storage_nonnegative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("physical_clusters.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    cpu_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cpu_cores: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cpu_threads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ram_total_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ram_used_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_usable_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    datacenter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rack: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rack_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ip_addresses: Mapped[list[dict[str, str]]] = mapped_column(JSONB, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    cluster: Mapped[PhysicalCluster] = relationship(back_populates="nodes")
```

- [ ] **Step 4: Create migration** — `backend/alembic/versions/0015_physical_clusters.py`:

```python
"""Physical clusters + nodes.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "physical_clusters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_physical_clusters_name_nonempty"),
    )
    op.create_table(
        "physical_nodes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "cluster_id",
            UUID(as_uuid=True),
            sa.ForeignKey("physical_clusters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("cpu_model", sa.String(255)),
        sa.Column("cpu_cores", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cpu_threads", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ram_total_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ram_used_gb", sa.Integer()),
        sa.Column("storage_usable_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("datacenter", sa.String(255)),
        sa.Column("rack", sa.String(100)),
        sa.Column("rack_unit", sa.String(50)),
        sa.Column("ip_addresses", JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_physical_nodes_name_nonempty"),
        sa.CheckConstraint("cpu_cores >= 0", name="ck_physical_nodes_cpu_cores_nonnegative"),
        sa.CheckConstraint("cpu_threads >= 0", name="ck_physical_nodes_cpu_threads_nonnegative"),
        sa.CheckConstraint("ram_total_gb >= 0", name="ck_physical_nodes_ram_total_nonnegative"),
        sa.CheckConstraint("storage_usable_gb >= 0", name="ck_physical_nodes_storage_nonnegative"),
    )


def downgrade() -> None:
    op.drop_table("physical_nodes")
    op.drop_table("physical_clusters")
```

- [ ] **Step 5: Run — expect pass** `pytest backend/tests/test_cluster_models.py -v` → 2 passed.
- [ ] **Step 6: Apply migration** `cd backend && APP_ENV=test DATABASE_URL="$TEST_DATABASE_URL" uv run alembic upgrade head` → no errors.
- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/alembic/versions/0015_physical_clusters.py backend/tests/test_cluster_models.py
git commit -m "feat(clusters): physical cluster + node models and migration"
```

---

## Task 2: Schemas

**Files:**
- Create: `backend/app/schemas/clusters.py`
- Test: `backend/tests/test_cluster_schemas.py`

**Interfaces:**
- Consumes: none beyond stdlib/pydantic.
- Produces: `NodeIpAddress`, `PhysicalNodeCreate`, `PhysicalNodeUpdate`, `PhysicalNodeRead`, `PhysicalClusterCreate`, `PhysicalClusterUpdate`, `PhysicalClusterListItem`, `PhysicalClusterDetail` — all importable from `app.schemas.clusters`. `PhysicalClusterDetail.nodes: list[PhysicalNodeRead]`.

- [ ] **Step 1: Write failing test** — `backend/tests/test_cluster_schemas.py`

```python
import pytest
from pydantic import ValidationError

from app.schemas.clusters import NodeIpAddress, PhysicalNodeCreate


def test_node_ip_address_requires_label_and_address():
    ip = NodeIpAddress(label="mgmt", address="10.0.1.5")
    assert ip.label == "mgmt" and ip.address == "10.0.1.5"
    with pytest.raises(ValidationError):
        NodeIpAddress(label="", address="10.0.1.5")


def test_node_create_defaults():
    n = PhysicalNodeCreate(name="node-01")
    assert n.cpu_cores == 0 and n.cpu_threads == 0 and n.ram_total_gb == 0
    assert n.storage_usable_gb == 0 and n.ram_used_gb is None and n.ip_addresses == []


def test_node_create_rejects_negative_cores():
    with pytest.raises(ValidationError):
        PhysicalNodeCreate(name="node-01", cpu_cores=-1)
```

- [ ] **Step 2: Run — expect fail** `pytest backend/tests/test_cluster_schemas.py -v` → `ModuleNotFoundError: No module named 'app.schemas.clusters'`.

- [ ] **Step 3: Write schemas** — `backend/app/schemas/clusters.py`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NodeIpAddress(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)


class PhysicalNodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    cpu_model: str | None = None
    cpu_cores: int = Field(default=0, ge=0)
    cpu_threads: int = Field(default=0, ge=0)
    ram_total_gb: int = Field(default=0, ge=0)
    ram_used_gb: int | None = Field(default=None, ge=0)
    storage_usable_gb: int = Field(default=0, ge=0)
    datacenter: str | None = None
    rack: str | None = None
    rack_unit: str | None = None
    ip_addresses: list[NodeIpAddress] = Field(default_factory=list)
    notes: str | None = None
    sort_order: int = 0


class PhysicalNodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    cpu_model: str | None = None
    cpu_cores: int | None = Field(default=None, ge=0)
    cpu_threads: int | None = Field(default=None, ge=0)
    ram_total_gb: int | None = Field(default=None, ge=0)
    ram_used_gb: int | None = Field(default=None, ge=0)
    storage_usable_gb: int | None = Field(default=None, ge=0)
    datacenter: str | None = None
    rack: str | None = None
    rack_unit: str | None = None
    ip_addresses: list[NodeIpAddress] | None = None
    notes: str | None = None
    sort_order: int | None = None


class PhysicalNodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    cluster_id: uuid.UUID
    name: str
    cpu_model: str | None
    cpu_cores: int
    cpu_threads: int
    ram_total_gb: int
    ram_used_gb: int | None
    storage_usable_gb: int
    datacenter: str | None
    rack: str | None
    rack_unit: str | None
    ip_addresses: list[NodeIpAddress]
    notes: str | None
    sort_order: int


class PhysicalClusterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    notes: str | None = None


class PhysicalClusterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    notes: str | None = None


class PhysicalClusterListItem(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    node_count: int
    total_ram_gb: int
    total_storage_gb: int


class PhysicalClusterDetail(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    notes: str | None
    nodes: list[PhysicalNodeRead]
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: Run — expect pass** `pytest backend/tests/test_cluster_schemas.py -v` → 3 passed.
- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/clusters.py backend/tests/test_cluster_schemas.py
git commit -m "feat(clusters): pydantic schemas"
```

---

## Task 3: Service layer

**Files:**
- Create: `backend/app/services/clusters.py`
- Test: `backend/tests/test_cluster_service.py`

**Interfaces:**
- Consumes: `PhysicalCluster`, `PhysicalNode` (`app.db.models`); `PhysicalClusterCreate`, `PhysicalClusterUpdate`, `PhysicalClusterListItem`, `PhysicalClusterDetail`, `PhysicalNodeRead` (`app.schemas.clusters`); `User` (`app.db.models`).
- Produces: `get_cluster_or_404(db, cluster_id) -> PhysicalCluster`, `get_cluster_detail_or_404(db, cluster_id) -> PhysicalCluster` (with `nodes` eagerly loaded), `create_cluster(db, payload, user) -> PhysicalCluster`, `update_cluster(db, cluster, payload, user) -> PhysicalCluster`, `delete_cluster(db, cluster) -> None`, `to_cluster_detail(cluster) -> PhysicalClusterDetail`, `list_clusters(db) -> list[PhysicalClusterListItem]` — all importable from `app.services.clusters`.

- [ ] **Step 1: Write failing test** — `backend/tests/test_cluster_service.py`

```python
from app.core.security import hash_password
from app.db.models import PhysicalCluster, PhysicalNode, User, UserRole
from app.schemas.clusters import PhysicalClusterCreate
from app.services import clusters


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_list_clusters_aggregates_nodes(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-a"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1", ram_total_gb=64, storage_usable_gb=1000))
    db_session.add(PhysicalNode(cluster_id=c.id, name="n2", ram_total_gb=128, storage_usable_gb=2000))
    db_session.commit()

    items = clusters.list_clusters(db_session)
    assert len(items) == 1
    assert items[0].node_count == 2
    assert items[0].total_ram_gb == 192
    assert items[0].total_storage_gb == 3000


def test_to_cluster_detail_includes_nodes(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-b"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1"))
    db_session.commit()

    detail = clusters.get_cluster_detail_or_404(db_session, c.id)
    out = clusters.to_cluster_detail(detail)
    assert out.name == "pve-b"
    assert len(out.nodes) == 1 and out.nodes[0].name == "n1"


def test_delete_cluster_cascades(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-c"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1"))
    db_session.commit()
    clusters.delete_cluster(db_session, c)
    assert db_session.query(PhysicalNode).count() == 0
```

- [ ] **Step 2: Run — expect fail** `pytest backend/tests/test_cluster_service.py -v` → `ModuleNotFoundError: No module named 'app.services.clusters'`.

- [ ] **Step 3: Write service** — `backend/app/services/clusters.py`:

```python
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import PhysicalCluster, PhysicalNode, User
from app.schemas.clusters import (
    PhysicalClusterCreate,
    PhysicalClusterDetail,
    PhysicalClusterListItem,
    PhysicalClusterUpdate,
    PhysicalNodeRead,
)

_NODES_OPTION = selectinload(PhysicalCluster.nodes)


def get_cluster_or_404(db: Session, cluster_id: uuid.UUID) -> PhysicalCluster:
    cluster = db.get(PhysicalCluster, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")
    return cluster


def get_cluster_detail_or_404(db: Session, cluster_id: uuid.UUID) -> PhysicalCluster:
    cluster = db.scalar(
        select(PhysicalCluster).options(_NODES_OPTION).where(PhysicalCluster.id == cluster_id)
    )
    if cluster is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")
    return cluster


def create_cluster(db: Session, payload: PhysicalClusterCreate, user: User) -> PhysicalCluster:
    cluster = PhysicalCluster(**payload.model_dump(), created_by_id=user.id, updated_by_id=user.id)
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    return cluster


def update_cluster(
    db: Session, cluster: PhysicalCluster, payload: PhysicalClusterUpdate, user: User
) -> PhysicalCluster:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cluster, key, value)
    cluster.updated_by_id = user.id
    db.commit()
    db.refresh(cluster)
    return cluster


def delete_cluster(db: Session, cluster: PhysicalCluster) -> None:
    db.delete(cluster)
    db.commit()


def to_cluster_detail(cluster: PhysicalCluster) -> PhysicalClusterDetail:
    return PhysicalClusterDetail(
        id=cluster.id,
        name=cluster.name,
        description=cluster.description,
        notes=cluster.notes,
        nodes=[PhysicalNodeRead.model_validate(n) for n in cluster.nodes],
        created_at=cluster.created_at,
        updated_at=cluster.updated_at,
    )


def list_clusters(db: Session) -> list[PhysicalClusterListItem]:
    all_clusters = db.scalars(select(PhysicalCluster).options(_NODES_OPTION)).all()
    items: list[PhysicalClusterListItem] = []
    for cluster in all_clusters:
        nodes: list[PhysicalNode] = cluster.nodes
        items.append(
            PhysicalClusterListItem(
                id=cluster.id,
                name=cluster.name,
                description=cluster.description,
                node_count=len(nodes),
                total_ram_gb=sum(n.ram_total_gb for n in nodes),
                total_storage_gb=sum(n.storage_usable_gb for n in nodes),
            )
        )
    return items
```

- [ ] **Step 4: Run — expect pass** `pytest backend/tests/test_cluster_service.py -v` → 3 passed.
- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clusters.py backend/tests/test_cluster_service.py
git commit -m "feat(clusters): service layer (CRUD + aggregates)"
```

---

## Task 4: Routes (cluster CRUD + nodes subrouter) + wiring

**Files:**
- Create: `backend/app/api/routes/clusters.py`
- Modify: `backend/app/main.py` (add import + `include_router` calls)
- Test: `backend/tests/test_cluster_api.py`, `backend/tests/test_auth_rbac_clusters.py`

**Interfaces:**
- Consumes: `Csrf`, `DbSession`, `EditorUser`, `ViewerUser` (`app.api.deps`); `PhysicalCluster`, `PhysicalNode` (`app.db.models`); all schemas from Task 2; `clusters` service module from Task 3.
- Produces: `router` (cluster CRUD, mounted at `/api/clusters`) and `nodes_router` (nested node CRUD, mounted at `/api/clusters/{cluster_id}/nodes`) — both importable from `app.api.routes.clusters`.

- [ ] **Step 1: Write failing test** — `backend/tests/test_cluster_api.py`

```python
from tests.conftest import auth_headers, create_user, login
from app.db.models import UserRole


def _mk(client, db, role=UserRole.editor):
    create_user(db, email="s@x.io", role=role)
    return login(client, "s@x.io")


def _create_cluster(client, csrf, **over):
    body = {"name": "pve-cluster-a"}
    body.update(over)
    return client.post("/api/clusters/", headers=auth_headers(csrf), json=body)


def test_create_and_detail(client, db_session):
    csrf = _mk(client, db_session)
    r = _create_cluster(client, csrf)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    d = client.get(f"/api/clusters/{cid}").json()
    assert d["name"] == "pve-cluster-a"
    assert d["nodes"] == []


def test_add_node_and_list_aggregates(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    n = client.post(
        f"/api/clusters/{cid}/nodes/",
        headers=auth_headers(csrf),
        json={
            "name": "node-01",
            "cpu_cores": 16,
            "cpu_threads": 32,
            "ram_total_gb": 128,
            "storage_usable_gb": 2000,
            "ip_addresses": [{"label": "mgmt", "address": "10.0.1.5"}],
            "datacenter": "dc-east-1",
            "rack": "Rack 12",
            "rack_unit": "U4",
        },
    )
    assert n.status_code == 201, n.text
    nid = n.json()["id"]
    assert n.json()["ip_addresses"] == [{"label": "mgmt", "address": "10.0.1.5"}]

    items = client.get("/api/clusters/").json()
    assert len(items) == 1
    assert items[0]["node_count"] == 1
    assert items[0]["total_ram_gb"] == 128
    assert items[0]["total_storage_gb"] == 2000

    d = client.get(f"/api/clusters/{cid}").json()
    assert len(d["nodes"]) == 1 and d["nodes"][0]["id"] == nid


def test_patch_node_partial_update(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    n = client.post(
        f"/api/clusters/{cid}/nodes/",
        headers=auth_headers(csrf),
        json={"name": "node-01", "ram_total_gb": 64},
    )
    nid = n.json()["id"]
    p = client.patch(
        f"/api/clusters/{cid}/nodes/{nid}",
        headers=auth_headers(csrf),
        json={"ram_used_gb": 32},
    )
    assert p.status_code == 200, p.text
    assert p.json()["ram_used_gb"] == 32 and p.json()["ram_total_gb"] == 64


def test_delete_cluster_cascades_nodes(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    client.post(
        f"/api/clusters/{cid}/nodes/", headers=auth_headers(csrf), json={"name": "node-01"}
    )
    r = client.delete(f"/api/clusters/{cid}", headers=auth_headers(csrf))
    assert r.status_code == 204
    assert client.get(f"/api/clusters/{cid}").status_code == 404
    assert client.get(f"/api/clusters/{cid}/nodes/").status_code == 404


def test_delete_node(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    nid = client.post(
        f"/api/clusters/{cid}/nodes/", headers=auth_headers(csrf), json={"name": "node-01"}
    ).json()["id"]
    r = client.delete(f"/api/clusters/{cid}/nodes/{nid}", headers=auth_headers(csrf))
    assert r.status_code == 204
    d = client.get(f"/api/clusters/{cid}").json()
    assert d["nodes"] == []
```

- [ ] **Step 2: Run — expect fail (404 route not registered).** `pytest backend/tests/test_cluster_api.py -v`

- [ ] **Step 3: Write routes** — `backend/app/api/routes/clusters.py`:

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import PhysicalCluster, PhysicalNode
from app.schemas.clusters import (
    PhysicalClusterCreate,
    PhysicalClusterDetail,
    PhysicalClusterListItem,
    PhysicalClusterUpdate,
    PhysicalNodeCreate,
    PhysicalNodeRead,
    PhysicalNodeUpdate,
)
from app.services import clusters

router = APIRouter()


@router.get("/", response_model=list[PhysicalClusterListItem])
def list_clusters(db: DbSession, _: ViewerUser) -> list[PhysicalClusterListItem]:
    return clusters.list_clusters(db)


@router.post("/", response_model=PhysicalClusterDetail, status_code=status.HTTP_201_CREATED)
def create_cluster(
    payload: PhysicalClusterCreate, db: DbSession, user: EditorUser, __: Csrf
) -> PhysicalClusterDetail:
    cluster = clusters.create_cluster(db, payload, user)
    detail = clusters.get_cluster_detail_or_404(db, cluster.id)
    return clusters.to_cluster_detail(detail)


@router.get("/{cluster_id}", response_model=PhysicalClusterDetail)
def get_cluster(cluster_id: uuid.UUID, db: DbSession, _: ViewerUser) -> PhysicalClusterDetail:
    cluster = clusters.get_cluster_detail_or_404(db, cluster_id)
    return clusters.to_cluster_detail(cluster)


@router.patch("/{cluster_id}", response_model=PhysicalClusterDetail)
def update_cluster(
    cluster_id: uuid.UUID, payload: PhysicalClusterUpdate, db: DbSession, user: EditorUser, __: Csrf
) -> PhysicalClusterDetail:
    cluster = clusters.get_cluster_or_404(db, cluster_id)
    clusters.update_cluster(db, cluster, payload, user)
    detail = clusters.get_cluster_detail_or_404(db, cluster_id)
    return clusters.to_cluster_detail(detail)


@router.delete("/{cluster_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cluster(cluster_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf) -> None:
    cluster = clusters.get_cluster_or_404(db, cluster_id)
    clusters.delete_cluster(db, cluster)


def make_cluster_subrouter(
    *,
    child_segment: str,
    model: type,
    fk_attr: str,
    parent_model: type,
    create_schema: type[BaseModel],
    update_schema: type[BaseModel],
    read_schema: type[BaseModel],
    order_col: Any,
    not_found_detail: str,
    parent_not_found_detail: str,
) -> APIRouter:
    """List/add/patch/delete for a cluster child, keyed on its parent id. Mirrors
    app.api.routes.storage.make_storage_subrouter — no health-score recompute needed here."""
    router = APIRouter()

    def _require_parent(db: DbSession, parent_id: uuid.UUID) -> None:
        if db.get(parent_model, parent_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=parent_not_found_detail
            )

    @router.get(f"/{{parent_id}}/{child_segment}/", response_model=list[read_schema])
    def list_items(parent_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list:
        _require_parent(db, parent_id)
        return list(
            db.scalars(
                select(model).where(getattr(model, fk_attr) == parent_id).order_by(order_col)
            )
        )

    @router.post(
        f"/{{parent_id}}/{child_segment}/",
        response_model=read_schema,
        status_code=status.HTTP_201_CREATED,
    )
    def add_item(
        parent_id: uuid.UUID, payload: create_schema, db: DbSession, _: EditorUser, __: Csrf
    ):  # type: ignore[valid-type]
        _require_parent(db, parent_id)
        item = model(**{fk_attr: parent_id}, **payload.model_dump())
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    @router.patch(f"/{{parent_id}}/{child_segment}/{{item_id}}", response_model=read_schema)
    def update_item(
        parent_id: uuid.UUID,
        item_id: uuid.UUID,
        payload: update_schema,
        db: DbSession,
        _: EditorUser,
        __: Csrf,  # type: ignore[valid-type]
    ):
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        db.commit()
        db.refresh(item)
        return item

    @router.delete(
        f"/{{parent_id}}/{child_segment}/{{item_id}}", status_code=status.HTTP_204_NO_CONTENT
    )
    def delete_item(
        parent_id: uuid.UUID, item_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
    ) -> None:
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        db.delete(item)
        db.commit()

    return router


nodes_router = make_cluster_subrouter(
    child_segment="nodes",
    model=PhysicalNode,
    fk_attr="cluster_id",
    parent_model=PhysicalCluster,
    create_schema=PhysicalNodeCreate,
    update_schema=PhysicalNodeUpdate,
    read_schema=PhysicalNodeRead,
    order_col=PhysicalNode.sort_order,
    not_found_detail="Node not found",
    parent_not_found_detail="Cluster not found",
)
```

`nodes_router` routes are declared relative to `/clusters` (paths start `/{parent_id}/nodes/...`), so it's mounted at the same prefix as `router`, not nested further — see wiring below.

- [ ] **Step 4: Wire into `backend/app/main.py`.** Two edits:

Add to the import block (after the `storage` import line):
```python
from app.api.routes.clusters import nodes_router as cluster_nodes_router
from app.api.routes.clusters import router as clusters_router
```

Add to `create_app()` after the storage router includes:
```python
    app.include_router(clusters_router, prefix="/api/clusters", tags=["clusters"])
    app.include_router(cluster_nodes_router, prefix="/api/clusters", tags=["clusters"])
```

- [ ] **Step 5: Write RBAC test** — `backend/tests/test_auth_rbac_clusters.py`:

```python
from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login

CLUSTER_BODY = {"name": "pve-cluster-a"}


def test_viewer_cannot_create(client, db_session):
    create_user(db_session, email="v@x.io", role=UserRole.viewer)
    csrf = login(client, "v@x.io")
    r = client.post("/api/clusters/", headers=auth_headers(csrf), json=CLUSTER_BODY)
    assert r.status_code == 403


def test_editor_create_without_csrf_forbidden(client, db_session):
    create_user(db_session, email="e@x.io", role=UserRole.editor)
    login(client, "e@x.io")
    r = client.post("/api/clusters/", json=CLUSTER_BODY)
    assert r.status_code == 403


def test_unauthenticated_list_forbidden(client, db_session):
    r = client.get("/api/clusters/")
    assert r.status_code == 401
```

- [ ] **Step 6: Run — expect pass** `pytest backend/tests/test_cluster_api.py backend/tests/test_auth_rbac_clusters.py -v` → 8 passed.
- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes/clusters.py backend/app/main.py backend/tests/test_cluster_api.py backend/tests/test_auth_rbac_clusters.py
git commit -m "feat(clusters): REST routes + RBAC/CSRF"
```

---

## Task 5: Frontend API client (types + methods)

**Files:**
- Modify: `frontend/src/api/client.ts:279` (insert new interfaces after the `ArrayPayload` type, before `const API_PREFIX`) and `frontend/src/api/client.ts:492` (insert new `api` methods after the `deleteShare` method, before the closing `};`)
- Test: `frontend/src/test/apiClient.test.ts` (append cases)

**Interfaces:**
- Consumes: `apiRequest<T>` helper (already defined in `client.ts`, used by every existing method).
- Produces: TS types `NodeIpAddress`, `PhysicalNode`, `PhysicalClusterListItem`, `PhysicalCluster`, `ClusterPayload`, `NodePayload`; `api.listClusters`, `api.getCluster`, `api.createCluster`, `api.updateCluster`, `api.deleteCluster`, `api.addNode`, `api.updateNode`, `api.deleteNode` — all exported from `frontend/src/api/client.ts` for use by Task 6/7 components.

- [ ] **Step 1: Write failing test** — append to `frontend/src/test/apiClient.test.ts`, matching its existing `fetchMock`/`fakeResponse`/`lastFetchCall` helpers (defined at the top of the file, `beforeEach` already resets `fetchMock` and assigns it to `global.fetch`):

```typescript
describe('clusters', () => {
  it('listClusters hits /api/clusters/', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '[]' }));
    await api.listClusters();
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/clusters/');
    expect(init.method).toBe('GET');
  });

  it('createCluster POSTs to /api/clusters/', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 201, body: '{"id":"c1"}' }));
    await api.createCluster({ name: 'pve-a' });
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/clusters/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'pve-a' });
  });

  it('addNode POSTs to /api/clusters/{id}/nodes/', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 201, body: '{"id":"n1"}' }));
    await api.addNode('c1', { name: 'node-01' });
    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/clusters/c1/nodes/');
    expect(init.method).toBe('POST');
  });
});
```

If `apiClient.test.ts` already imports `vi`, `describe`, `it`, `expect` and a fetch-mocking convention (check the top of the file before writing — match its exact pattern rather than the `vi.stubGlobal` shown here if it differs).

- [ ] **Step 2: Run — expect fail** `cd frontend && bun run test apiClient.test.ts` → `api.listClusters is not a function`.

- [ ] **Step 3: Add types** — insert into `frontend/src/api/client.ts` immediately after line 279 (the `ArrayPayload` type, before the blank lines and `const API_PREFIX`):

```typescript
export interface NodeIpAddress {
  label: string;
  address: string;
}

export interface PhysicalNode {
  id: string;
  cluster_id: string;
  name: string;
  cpu_model: string | null;
  cpu_cores: number;
  cpu_threads: number;
  ram_total_gb: number;
  ram_used_gb: number | null;
  storage_usable_gb: number;
  datacenter: string | null;
  rack: string | null;
  rack_unit: string | null;
  ip_addresses: NodeIpAddress[];
  notes: string | null;
  sort_order: number;
}

export interface PhysicalClusterListItem {
  id: string;
  name: string;
  description: string | null;
  node_count: number;
  total_ram_gb: number;
  total_storage_gb: number;
}

export interface PhysicalCluster {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  nodes: PhysicalNode[];
  created_at: string;
  updated_at: string;
}

export type ClusterPayload = Partial<Omit<PhysicalCluster, 'id' | 'nodes' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export type NodePayload = Partial<Omit<PhysicalNode, 'id' | 'cluster_id'>> & {
  name: string;
};
```

- [ ] **Step 4: Add API methods** — insert into the `api` object in `frontend/src/api/client.ts` immediately after the `deleteShare` method (the line before the closing `};` of the `api` const, currently line 491):

```typescript
  listClusters: () => apiRequest<PhysicalClusterListItem[]>('/clusters/'),
  getCluster: (id: string) => apiRequest<PhysicalCluster>(`/clusters/${id}`),
  createCluster: (payload: ClusterPayload) =>
    apiRequest<PhysicalCluster>('/clusters/', { method: 'POST', body: JSON.stringify(payload) }),
  updateCluster: (id: string, payload: Partial<ClusterPayload>) =>
    apiRequest<PhysicalCluster>(`/clusters/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCluster: (id: string) => apiRequest<null>(`/clusters/${id}`, { method: 'DELETE' }),

  addNode: (clusterId: string, payload: NodePayload) =>
    apiRequest<PhysicalNode>(`/clusters/${clusterId}/nodes/`, { method: 'POST', body: JSON.stringify(payload) }),
  updateNode: (clusterId: string, nodeId: string, payload: Partial<NodePayload>) =>
    apiRequest<PhysicalNode>(`/clusters/${clusterId}/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteNode: (clusterId: string, nodeId: string) =>
    apiRequest<null>(`/clusters/${clusterId}/nodes/${nodeId}`, { method: 'DELETE' }),
```

- [ ] **Step 5: Run — expect pass** `cd frontend && bun run test apiClient.test.ts` → all pass.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/test/apiClient.test.ts
git commit -m "feat(clusters): frontend API client types + methods"
```

---

## Task 6: Clusters list page + nav wiring

**Files:**
- Create: `frontend/src/components/ClusterForm.tsx`
- Create: `frontend/src/routes/ClustersPage.tsx`
- Create: `frontend/src/app/(app)/clusters/page.tsx`
- Modify: `frontend/src/components/AppNav.tsx:54-79` (add `IconCluster` + nav item)
- Test: `frontend/src/test/ClustersPage.test.tsx`

**Interfaces:**
- Consumes: `api.listClusters`, `api.createCluster` (Task 5); `ClusterPayload`, `PhysicalClusterListItem` (Task 5); `Alert`, `PageHeader`, `PageTransition`, `Skeleton`, `primaryButtonClass`, `cardClass`, `tableWrapClass`, `tableClass`, `tableHeadClass`, `tableBodyClass`, `tableRowClass`, `tableCellClass`, `labelClass`, `inputClass`, `textareaClass`, `secondaryButtonClass`, `Spinner` (`../components/ui`); `useCurrentUser` (`../components/AuthContext`); `detailMessage` (`../api/client`).
- Produces: `ClusterForm` component (`{ initial?, onSubmit, onCancel, pending, submitLabel }` props, mirrors `ArrayForm`); `ClustersPage` component exported for the thin-shell route and for Task 7's "Back" navigation target (`/clusters`).

- [ ] **Step 1: Write failing test** — `frontend/src/test/ClustersPage.test.tsx`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { PhysicalClusterListItem } from '../api/client';
import { ClustersPage } from '../routes/ClustersPage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hoisted.pushMock }) }));

beforeEach(() => { hoisted.pushMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function makeCluster(overrides: Partial<PhysicalClusterListItem> = {}): PhysicalClusterListItem {
  return {
    id: 'c1',
    name: 'pve-cluster-a',
    description: null,
    node_count: 3,
    total_ram_gb: 384,
    total_storage_gb: 6000,
    ...overrides,
  };
}

describe('ClustersPage', () => {
  it('renders a cluster row with node count and totals', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([makeCluster()]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText('pve-cluster-a')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('384')).toBeInTheDocument();
    expect(screen.getByText('6000')).toBeInTheDocument();
  });

  it('shows an empty state when there are no clusters', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText(/no clusters yet/i)).toBeInTheDocument();
  });

  it('renders an error alert on failure', async () => {
    vi.spyOn(api, 'listClusters').mockRejectedValue(new Error('boom'));
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides the New cluster button for viewers', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'viewer' }) });
    await waitFor(() => expect(api.listClusters).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /new cluster/i })).not.toBeInTheDocument();
  });

  it('creates a cluster and navigates to its detail page (editor)', async () => {
    vi.spyOn(api, 'listClusters').mockResolvedValue([]);
    const created = makeCluster();
    vi.spyOn(api, 'createCluster').mockResolvedValue({
      id: created.id, name: created.name, description: null, notes: null, nodes: [],
      created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
    });
    renderWithProviders(<ClustersPage />, { user: makeUser({ role: 'editor' }) });
    fireEvent.click(await screen.findByRole('button', { name: /new cluster/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'pve-cluster-a' } });
    fireEvent.click(screen.getByRole('button', { name: /create cluster/i }));
    await waitFor(() => expect(api.createCluster).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pve-cluster-a' }),
    ));
    await waitFor(() => expect(hoisted.pushMock).toHaveBeenCalledWith('/clusters/c1'));
  });
});
```

- [ ] **Step 2: Run — expect fail** `cd frontend && bun run test ClustersPage.test.tsx` → `Cannot find module '../routes/ClustersPage'`.

- [ ] **Step 3: Write `ClusterForm`** — `frontend/src/components/ClusterForm.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { ClusterPayload } from '../api/client';
import { Spinner, inputClass, textareaClass, labelClass, primaryButtonClass, secondaryButtonClass } from './ui';

export interface ClusterFormValues {
  name: string;
  description: string;
  notes: string;
}

const EMPTY: ClusterFormValues = { name: '', description: '', notes: '' };

function toPayload(v: ClusterFormValues): ClusterPayload {
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    notes: v.notes.trim() || null,
  };
}

export function ClusterForm({ initial, onSubmit, onCancel, pending, submitLabel }: {
  initial?: Partial<ClusterFormValues>;
  onSubmit: (payload: ClusterPayload) => void;
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [v, setV] = useState<ClusterFormValues>({ ...EMPTY, ...initial });
  const set = (k: keyof ClusterFormValues) => (e: { target: { value: string } }) =>
    setV((c) => ({ ...c, [k]: e.target.value }));
  const valid = v.name.trim() !== '';

  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className={labelClass}>Name</span>
        <input type="text" aria-label="Name" value={v.name} onChange={set('name')} className={inputClass} />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>Description</span>
        <textarea aria-label="Description" value={v.description} onChange={set('description')} className={textareaClass} />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>Notes</span>
        <textarea aria-label="Notes" value={v.notes} onChange={set('notes')} className={textareaClass} />
      </label>
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={!valid || pending}
          onClick={() => onSubmit(toPayload(v))}>
          {pending ? <Spinner /> : null}{submitLabel}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `ClustersPage`** — `frontend/src/routes/ClustersPage.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ClusterPayload, PhysicalClusterListItem } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton, primaryButtonClass, cardClass, tableWrapClass, tableClass, tableHeadClass, tableBodyClass, tableRowClass, tableCellClass } from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ClusterForm } from '../components/ClusterForm';

export function ClustersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const [showForm, setShowForm] = useState(false);

  const clustersQ = useQuery({ queryKey: ['clusters'], queryFn: () => api.listClusters() });
  const clusterList: PhysicalClusterListItem[] = clustersQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: ClusterPayload) => api.createCluster(payload),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clusters'] });
      setShowForm(false);
      router.push(`/clusters/${created.id}`);
    },
  });

  return (
    <PageTransition>
      <PageHeader title="Clusters" eyebrow="Infrastructure" actions={
        canEdit && !showForm ? (
          <button className={primaryButtonClass} onClick={() => setShowForm(true)}>+ New cluster</button>
        ) : null
      } />

      {canEdit && showForm ? (
        <div className={`${cardClass} mb-6`}>
          <ClusterForm
            onSubmit={(payload) => createMut.mutate(payload)}
            onCancel={() => setShowForm(false)}
            pending={createMut.isPending}
            submitLabel="Create cluster"
          />
          {createMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(createMut.error)}</p> : null}
        </div>
      ) : null}

      {clustersQ.isError ? <Alert>{detailMessage(clustersQ.error)}</Alert> : null}

      {clustersQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : clusterList.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-slate-500 dark:text-slate-400`}>
          No clusters yet.
        </div>
      ) : (
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={`${tableCellClass} text-left font-semibold`}>Name</th>
                <th className={`${tableCellClass} text-left font-semibold`}>Description</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Nodes</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Total RAM (GB)</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Total storage (GB)</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {clusterList.map((c) => (
                <tr key={c.id} className={tableRowClass}>
                  <td className={tableCellClass}>
                    <Link href={`/clusters/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tableCellClass}>{c.description ?? '—'}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.node_count}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.total_ram_gb}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{c.total_storage_gb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageTransition>
  );
}
```

- [ ] **Step 5: Write thin-shell route** — `frontend/src/app/(app)/clusters/page.tsx`:

```typescript
import { ClustersPage } from '../../../routes/ClustersPage';

export default function ClustersRoute() {
  return <ClustersPage />;
}
```

- [ ] **Step 6: Wire nav** — in `frontend/src/components/AppNav.tsx`, add an icon function after `IconStorage` (currently ending line 60):

```typescript
function IconCluster() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
```

Then add the nav entry inside `buildNavItems` (currently `frontend/src/components/AppNav.tsx:73-78`), between the Storage and Import entries:

```typescript
    { to: '/inventory', label: 'Inventory', visible: true, icon: <IconGrid /> },
    { to: '/storage', label: 'Storage', visible: true, icon: <IconStorage /> },
    { to: '/clusters', label: 'Clusters', visible: true, icon: <IconCluster /> },
    { to: '/imports/new', label: 'Import', visible: user.role === 'admin' || user.role === 'editor', icon: <IconUpload /> },
    { to: '/settings', label: 'Settings', visible: canSeeUsers(user.role), icon: <IconGear /> },
```

- [ ] **Step 7: Run — expect pass** `cd frontend && bun run test ClustersPage.test.tsx` → 5 passed.
- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ClusterForm.tsx frontend/src/routes/ClustersPage.tsx frontend/src/app/\(app\)/clusters/page.tsx frontend/src/components/AppNav.tsx frontend/src/test/ClustersPage.test.tsx
git commit -m "feat(clusters): list page + nav entry"
```

---

## Task 7: Cluster detail page (node CRUD)

**Files:**
- Create: `frontend/src/routes/ClusterDetailPage.tsx`
- Create: `frontend/src/app/(app)/clusters/[id]/page.tsx`
- Test: `frontend/src/test/ClusterDetailPage.test.tsx`

**Interfaces:**
- Consumes: `api.getCluster`, `api.updateCluster`, `api.deleteCluster`, `api.addNode`, `api.updateNode`, `api.deleteNode` (Task 5); `PhysicalCluster`, `PhysicalNode`, `ClusterPayload` (Task 5); `ClusterForm`, `ClusterFormValues` (Task 6); `Alert`, `PageHeader`, `PageTransition`, `Skeleton`, `Spinner`, `dangerButtonClass`, `primaryButtonClass`, `secondaryButtonClass`, `sectionTitleClass` (`../components/ui`).
- Produces: `ClusterDetailPage` component for the thin-shell route.

- [ ] **Step 1: Write failing test** — `frontend/src/test/ClusterDetailPage.test.tsx`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import type { PhysicalCluster } from '../api/client';
import { ClusterDetailPage } from '../routes/ClusterDetailPage';
import { makeUser, renderWithProviders } from './utils';

const hoisted = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: hoisted.pushMock }),
}));

function makeCluster(): PhysicalCluster {
  return {
    id: 'c1', name: 'pve-cluster-a', description: 'primary DC', notes: null,
    created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
    nodes: [{
      id: 'n1', cluster_id: 'c1', name: 'node-01', cpu_model: 'Xeon E5-2680 v4',
      cpu_cores: 16, cpu_threads: 32, ram_total_gb: 128, ram_used_gb: 64,
      storage_usable_gb: 2000, datacenter: 'dc-east-1', rack: 'Rack 12', rack_unit: 'U4',
      ip_addresses: [{ label: 'mgmt', address: '10.0.1.5' }], notes: null, sort_order: 0,
    }],
  };
}

beforeEach(() => { hoisted.pushMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ClusterDetailPage', () => {
  it('renders cluster header and node row', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText('pve-cluster-a')).toBeInTheDocument();
    expect(screen.getByText('node-01')).toBeInTheDocument();
    expect(screen.getByText('mgmt 10.0.1.5')).toBeInTheDocument();
    expect(screen.getByText('64 / 128 GB')).toBeInTheDocument();
  });

  it('adding a node calls api.addNode', async () => {
    const cluster = makeCluster();
    vi.spyOn(api, 'getCluster').mockResolvedValue(cluster);
    vi.spyOn(api, 'addNode').mockResolvedValue(cluster.nodes[0]);
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.change(screen.getByPlaceholderText('Node name'), { target: { value: 'node-02' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    await waitFor(() => expect(api.addNode).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'node-02' })));
  });

  it('hides add form and delete buttons for viewers', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    await screen.findByText('pve-cluster-a');
    expect(screen.queryByPlaceholderText('Node name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove node/i })).not.toBeInTheDocument();
  });

  it('deletes a node and the cluster (editor)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    vi.spyOn(api, 'deleteNode').mockResolvedValue(null);
    vi.spyOn(api, 'deleteCluster').mockResolvedValue(null);
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.click(screen.getByRole('button', { name: /remove node node-01/i }));
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('c1', 'n1'));
    fireEvent.click(screen.getByRole('button', { name: /delete cluster/i }));
    await waitFor(() => expect(api.deleteCluster).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(hoisted.pushMock).toHaveBeenCalledWith('/clusters'));
  });

  it('edits the cluster and calls api.updateCluster (editor)', async () => {
    vi.spyOn(api, 'getCluster').mockResolvedValue(makeCluster());
    vi.spyOn(api, 'updateCluster').mockResolvedValue(makeCluster());
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'editor' }) });
    await screen.findByText('pve-cluster-a');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'pve-cluster-a2' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.updateCluster).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'pve-cluster-a2' })));
  });

  it('renders an empty-nodes message and an error state', async () => {
    vi.spyOn(api, 'getCluster').mockRejectedValueOnce(new Error('boom'));
    const { unmount } = renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    unmount();

    vi.spyOn(api, 'getCluster').mockResolvedValue({ ...makeCluster(), nodes: [] });
    renderWithProviders(<ClusterDetailPage />, { user: makeUser({ role: 'viewer' }) });
    expect(await screen.findByText(/no nodes yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail** `cd frontend && bun run test ClusterDetailPage.test.tsx` → `Cannot find module '../routes/ClusterDetailPage'`.

- [ ] **Step 3: Write `ClusterDetailPage`** — `frontend/src/routes/ClusterDetailPage.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, ClusterPayload, PhysicalCluster, PhysicalNode } from '../api/client';
import {
  Alert, PageHeader, PageTransition, Skeleton, Spinner,
  dangerButtonClass, primaryButtonClass, secondaryButtonClass, sectionTitleClass,
} from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { ClusterForm } from '../components/ClusterForm';
import type { ClusterFormValues } from '../components/ClusterForm';

interface NodeFieldDef {
  name: string;
  placeholder: string;
  type?: string;
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400">
      ×
    </button>
  );
}

const NODE_FIELDS: NodeFieldDef[] = [
  { name: 'name', placeholder: 'Node name' },
  { name: 'cpu_model', placeholder: 'CPU model' },
  { name: 'cpu_cores', placeholder: 'CPU cores', type: 'number' },
  { name: 'cpu_threads', placeholder: 'CPU threads', type: 'number' },
  { name: 'ram_total_gb', placeholder: 'RAM total GB', type: 'number' },
  { name: 'ram_used_gb', placeholder: 'RAM used GB', type: 'number' },
  { name: 'storage_usable_gb', placeholder: 'Storage GB', type: 'number' },
  { name: 'datacenter', placeholder: 'Datacenter' },
  { name: 'rack', placeholder: 'Rack' },
  { name: 'rack_unit', placeholder: 'Rack unit' },
  { name: 'ip_label', placeholder: 'IP label (e.g. mgmt)' },
  { name: 'ip_address', placeholder: 'IP address' },
];

function NodeAddForm({ onSubmit, pending }: {
  onSubmit: (payload: Partial<PhysicalNode> & { name: string }) => void;
  pending: boolean;
}) {
  const blank = () => Object.fromEntries(NODE_FIELDS.map((f) => [f.name, '']));
  const [values, setValues] = useState<Record<string, string>>(blank);
  const inputClass = 'min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400';

  function submit() {
    const v = values;
    const ip_addresses = v.ip_label.trim() && v.ip_address.trim()
      ? [{ label: v.ip_label.trim(), address: v.ip_address.trim() }]
      : [];
    onSubmit({
      name: v.name.trim(),
      cpu_model: v.cpu_model.trim() || null,
      cpu_cores: Number(v.cpu_cores) || 0,
      cpu_threads: Number(v.cpu_threads) || 0,
      ram_total_gb: Number(v.ram_total_gb) || 0,
      ram_used_gb: v.ram_used_gb.trim() ? Number(v.ram_used_gb) : null,
      storage_usable_gb: Number(v.storage_usable_gb) || 0,
      datacenter: v.datacenter.trim() || null,
      rack: v.rack.trim() || null,
      rack_unit: v.rack_unit.trim() || null,
      ip_addresses,
    });
    setValues(blank());
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      {NODE_FIELDS.map((f) => (
        <input key={f.name} type={f.type ?? 'text'} placeholder={f.placeholder} value={values[f.name]}
          aria-label={f.placeholder}
          onChange={(e) => setValues((c) => ({ ...c, [f.name]: e.target.value }))} className={inputClass} />
      ))}
      <button type="button" onClick={submit} disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
        {pending ? <Spinner /> : null}+ Add
      </button>
    </div>
  );
}

function RamBar({ used, total }: { used: number | null; total: number }) {
  const pct = total > 0 && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-24 text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
        {used === null ? '—' : `${used} / ${total} GB`}
      </span>
    </div>
  );
}

function NodesArea({ cluster, canEdit }: { cluster: PhysicalCluster; canEdit: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cluster', cluster.id] });
  const addNode = useMutation({
    mutationFn: (payload: Partial<PhysicalNode> & { name: string }) => api.addNode(cluster.id, payload),
    onSuccess: invalidate,
  });
  const delNode = useMutation({
    mutationFn: (nodeId: string) => api.deleteNode(cluster.id, nodeId),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <h2 className={sectionTitleClass}>Nodes</h2>
      {cluster.nodes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No nodes yet.</p>
      ) : (
        <table className="mt-1 w-full text-sm"><thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="pb-1 pr-4">Name</th><th className="pb-1 pr-4">IPs</th><th className="pb-1 pr-4">CPU model</th>
            <th className="pb-1 pr-4">Cores/Threads</th><th className="pb-1 pr-4">RAM</th><th className="pb-1 pr-4">Storage (GB)</th>
            <th className="pb-1 pr-4">Location</th><th />
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {cluster.nodes.map((n) => (
              <tr key={n.id}>
                <td className="py-1.5 pr-4 font-mono text-slate-700 dark:text-slate-300">{n.name}</td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">
                  {n.ip_addresses.length === 0 ? '—' : n.ip_addresses.map((ip) => `${ip.label} ${ip.address}`).join(', ')}
                </td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{n.cpu_model ?? '—'}</td>
                <td className="py-1.5 pr-4 tabular-nums">{n.cpu_cores} / {n.cpu_threads}</td>
                <td className="py-1.5 pr-4"><RamBar used={n.ram_used_gb} total={n.ram_total_gb} /></td>
                <td className="py-1.5 pr-4 tabular-nums">{n.storage_usable_gb}</td>
                <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">
                  {[n.datacenter, n.rack, n.rack_unit].filter(Boolean).join(' / ') || '—'}
                </td>
                <td className="py-1.5">{canEdit && <RemoveButton onClick={() => delNode.mutate(n.id)} label={`Remove node ${n.name}`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && <NodeAddForm onSubmit={(v) => addNode.mutate(v)} pending={addNode.isPending} />}
      {addNode.isError && <p className="mt-1 text-xs text-red-600">{detailMessage(addNode.error)}</p>}
    </div>
  );
}

export function ClusterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';

  const clusterQ = useQuery({ queryKey: ['cluster', id], queryFn: () => api.getCluster(id) });
  const cluster = clusterQ.data;

  const deleteMut = useMutation({
    mutationFn: () => api.deleteCluster(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters'] }); router.push('/clusters'); },
  });

  const [editing, setEditing] = useState(false);
  const updateMut = useMutation({
    mutationFn: (payload: ClusterPayload) => api.updateCluster(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cluster', id] });
      qc.invalidateQueries({ queryKey: ['clusters'] });
      setEditing(false);
    },
  });

  if (clusterQ.isLoading) return <PageTransition><Skeleton className="h-64 w-full" /></PageTransition>;
  if (clusterQ.isError) return <PageTransition><Alert>{detailMessage(clusterQ.error)}</Alert></PageTransition>;
  if (!cluster) return null;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl space-y-5">
        <PageHeader title={cluster.name} eyebrow="Cluster" actions={
          <>
            <button className={secondaryButtonClass} onClick={() => router.push('/clusters')}>← Back</button>
            {canEdit && (
              <button className={dangerButtonClass}
                onClick={() => { if (confirm(`Delete cluster ${cluster.name} and all its nodes? This cannot be undone.`)) deleteMut.mutate(); }}
                disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Spinner />} Delete cluster
              </button>
            )}
          </>
        } />

        {deleteMut.isError && <Alert>{detailMessage(deleteMut.error)}</Alert>}

        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
          <div className="flex items-center justify-between">
            <h2 className={sectionTitleClass}>Details</h2>
            {canEdit && !editing ? (
              <button className={primaryButtonClass} onClick={() => setEditing(true)}>Edit</button>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-4">
              <ClusterForm
                initial={{
                  name: cluster.name,
                  description: cluster.description ?? '',
                  notes: cluster.notes ?? '',
                } as Partial<ClusterFormValues>}
                onSubmit={(payload) => updateMut.mutate(payload)}
                onCancel={() => setEditing(false)}
                pending={updateMut.isPending}
                submitLabel="Save changes"
              />
              {updateMut.isError ? <p className="mt-2 text-xs text-red-600">{detailMessage(updateMut.error)}</p> : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{cluster.description || 'No description.'}</p>
          )}
        </section>

        <NodesArea cluster={cluster} canEdit={canEdit} />
      </section>
    </PageTransition>
  );
}
```

- [ ] **Step 4: Write thin-shell route** — `frontend/src/app/(app)/clusters/[id]/page.tsx`:

```typescript
import { ClusterDetailPage } from '../../../../routes/ClusterDetailPage';

export default function ClusterDetailRoute() {
  return <ClusterDetailPage />;
}
```

- [ ] **Step 5: Run — expect pass** `cd frontend && bun run test ClusterDetailPage.test.tsx` → 6 passed.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/ClusterDetailPage.tsx frontend/src/app/\(app\)/clusters/\[id\]/page.tsx frontend/src/test/ClusterDetailPage.test.tsx
git commit -m "feat(clusters): detail page with node CRUD"
```

---

## Task 8: Full verify + docs

**Files:**
- Modify: `CLAUDE.md` (Database section — note the new `physical_clusters`/`physical_nodes` tables)

- [ ] **Step 1:** `graphify update .` (refresh graph after edits).
- [ ] **Step 2:** `just verify` (full gate: ruff, type check, pytest real-PG, vitest 80%, tsc, playwright). Fix anything red.
- [ ] **Step 3:** Add one line to `CLAUDE.md` under `## Database`, after the existing enum bullet:

```markdown
- `PhysicalCluster`/`PhysicalNode` (`physical_clusters`/`physical_nodes` tables) are a
  documentation-only inventory of physical hardware — no VM linkage yet (planned
  integration phase). Mirrors the `StorageArray`/`StorageVolume` parent-child pattern.
```

- [ ] **Step 4: Commit** `git commit -am "chore(clusters): verify gate + docs"` and open PR.

---

## Verification (end-to-end)

1. **Migration:** `cd backend && alembic upgrade head` — confirms `physical_clusters` and `physical_nodes` tables created with all check constraints.
2. **API smoke:** create cluster `pve-cluster-a`; add node with `ram_total_gb=128`, `ram_used_gb=64`, `ip_addresses=[{label:"mgmt",address:"10.0.1.5"}]`, `datacenter/rack/rack_unit` set; `GET /api/clusters/{id}` → node appears with all fields roundtripped; `GET /api/clusters/` → `node_count=1`, `total_ram_gb=128`, `total_storage_gb` matches; delete cluster → node gone.
3. **RBAC/CSRF:** viewer POST → 403; editor POST w/o `X-CSRF-Token` → 403; unauthenticated GET → 401.
4. **UI (playwright MCP or dev server):** Clusters nav item visible → list page shows cluster row with node/RAM/storage totals → detail page shows node table with IP badges and RAM bar → add node via inline form → row appears → edit cluster name → delete node → delete cluster → redirected to `/clusters`.
5. `just verify` green.

## Spec coverage self-check

Two-level Cluster/Node model ✓ (T1) · JSONB IP addresses with label+address ✓ (T1/T2) · per-node CPU/RAM/storage fields ✓ (T1) · RAM used/total nullable-used ✓ (T1/T2) · datacenter/rack/rack_unit location per node ✓ (T1) · no cluster-level datacenter field (spans racks) ✓ (T1) · REST CRUD for clusters + nested nodes ✓ (T4) · RBAC (viewer read / editor+ write) + CSRF ✓ (T4) · cascade delete cluster→nodes ✓ (T1/T3/T4) · aggregate node_count/total_ram_gb/total_storage_gb on list ✓ (T3/T4) · frontend client ✓ (T5) · list page (flat table, no location grouping — per user decision) ✓ (T6) · nav entry ✓ (T6) · detail page with node CRUD, IP badges, RAM bar ✓ (T7) · PATCH partial-update semantics (deviates from spec's PUT, per user decision) ✓ (T4) · out-of-scope (no VM linkage, no CSV import, no polling, no rich location hierarchy) ✓ — nothing implemented for these.
