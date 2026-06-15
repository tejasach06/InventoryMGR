import uuid
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserRole(StrEnum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class Platform(StrEnum):
    proxmox = "proxmox"
    vmware = "vmware"


class VmStatus(StrEnum):
    running = "running"
    stopped = "stopped"
    suspended = "suspended"
    unknown = "unknown"


class Criticality(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Lifecycle(StrEnum):
    planned = "planned"
    active = "active"
    retiring = "retiring"
    retired = "retired"


class ImportStatus(StrEnum):
    previewed = "previewed"
    committed = "committed"
    cancelled = "cancelled"


class ImportAction(StrEnum):
    create = "create"
    update = "update"
    conflict = "conflict"
    invalid = "invalid"


def now_utc() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Vm(Base, TimestampMixin):
    __tablename__ = "vms"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="ck_vms_name_nonempty"),
        CheckConstraint("length(btrim(environment)) > 0", name="ck_vms_environment_nonempty"),
        CheckConstraint("length(btrim(cluster)) > 0", name="ck_vms_cluster_nonempty"),
        CheckConstraint("length(btrim(host)) > 0", name="ck_vms_host_nonempty"),
        CheckConstraint("cpu_cores >= 0", name="ck_vms_cpu_cores_nonnegative"),
        CheckConstraint("memory_mb >= 0", name="ck_vms_memory_mb_nonnegative"),
        CheckConstraint("disk_gb >= 0", name="ck_vms_disk_gb_nonnegative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform"), nullable=False)
    environment: Mapped[str] = mapped_column(String(100), nullable=False)
    datacenter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cluster: Mapped[str] = mapped_column(String(255), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[VmStatus] = mapped_column(Enum(VmStatus, name="vm_status"), nullable=False)
    cpu_cores: Mapped[int] = mapped_column(Integer, nullable=False)
    memory_mb: Mapped[int] = mapped_column(Integer, nullable=False)
    disk_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    os_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_addresses: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    backup_status: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ha_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dr_tier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    criticality: Mapped[Criticality] = mapped_column(
        Enum(Criticality, name="criticality"), nullable=False
    )
    lifecycle: Mapped[Lifecycle] = mapped_column(Enum(Lifecycle, name="lifecycle"), nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    last_verified_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    updated_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User] = relationship(foreign_keys=[updated_by_id])


Index(
    "uq_vms_platform_environment_external_id",
    Vm.platform,
    Vm.environment,
    Vm.external_id,
    unique=True,
    postgresql_where=Vm.external_id.is_not(None),
)
Index(
    "uq_vms_platform_environment_name_without_external_id",
    Vm.platform,
    Vm.environment,
    func.lower(Vm.name),
    unique=True,
    postgresql_where=Vm.external_id.is_(None),
)
Index("ix_vms_platform", Vm.platform)
Index("ix_vms_environment", Vm.environment)
Index("ix_vms_cluster", Vm.cluster)
Index("ix_vms_host", Vm.host)
Index("ix_vms_status", Vm.status)
Index("ix_vms_criticality", Vm.criticality)
Index("ix_vms_lifecycle", Vm.lifecycle)


class CsvImportBatch(Base):
    __tablename__ = "csv_import_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[ImportStatus] = mapped_column(
        Enum(ImportStatus, name="import_status"), nullable=False, default=ImportStatus.previewed
    )
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[User] = relationship()
    rows: Mapped[list["CsvImportRow"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", order_by="CsvImportRow.row_number"
    )


class CsvImportRow(Base):
    __tablename__ = "csv_import_rows"
    __table_args__ = (
        UniqueConstraint("batch_id", "row_number", name="uq_csv_import_rows_batch_row"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("csv_import_batches.id"), nullable=False
    )
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    normalized: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    action: Mapped[ImportAction] = mapped_column(
        Enum(ImportAction, name="import_action"), nullable=False
    )
    target_vm_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="SET NULL"), nullable=True
    )
    errors: Mapped[list[dict[str, str]]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )

    batch: Mapped[CsvImportBatch] = relationship(back_populates="rows")
    target_vm: Mapped[Vm | None] = relationship()
