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

# ponytail: JSONB for preferences — flexible per-user config without schema changes


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
    powered_off = "powered_off"
    suspended = "suspended"
    archived = "archived"
    decommissioned = "decommissioned"
    unknown = "unknown"


class Environment(StrEnum):
    production = "production"
    development = "development"
    testing = "testing"
    uat = "uat"
    dr = "dr"
    staging = "staging"
    sandbox = "sandbox"


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


class VmType(StrEnum):
    permanent = "permanent"
    temporary = "temporary"


class OsFamily(StrEnum):
    linux = "linux"
    windows = "windows"


os_family_enum = Enum(OsFamily, name="os_family")


class ImportStatus(StrEnum):
    previewed = "previewed"
    committed = "committed"
    cancelled = "cancelled"


class ImportAction(StrEnum):
    create = "create"
    update = "update"
    conflict = "conflict"
    invalid = "invalid"


class DropdownCategory(StrEnum):
    cpu = "cpu"
    datacenter = "datacenter"
    disk = "disk"
    os = "os"


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
    preferences: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")


class Vm(Base, TimestampMixin):
    __tablename__ = "vms"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="ck_vms_name_nonempty"),
        CheckConstraint("length(btrim(cluster)) > 0", name="ck_vms_cluster_nonempty"),
        CheckConstraint("cpu_cores >= 0", name="ck_vms_cpu_cores_nonnegative"),
        CheckConstraint("memory_mb >= 0", name="ck_vms_memory_mb_nonnegative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    fqdn: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform"), nullable=False)
    datacenter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sr_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cluster: Mapped[str] = mapped_column(String(255), nullable=False)
    node: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[VmStatus] = mapped_column(Enum(VmStatus, name="vm_status"), nullable=False)
    environment: Mapped[Environment] = mapped_column(
        Enum(Environment, name="environment"), nullable=False, default=Environment.production
    )
    criticality: Mapped[Criticality] = mapped_column(
        Enum(Criticality, name="criticality"), nullable=False
    )
    lifecycle: Mapped[Lifecycle] = mapped_column(Enum(Lifecycle, name="lifecycle"), nullable=False)
    vm_type: Mapped[VmType] = mapped_column(
        Enum(VmType, name="vm_type"), nullable=False, default=VmType.permanent
    )
    cpu_cores: Mapped[int] = mapped_column(Integer, nullable=False)
    memory_mb: Mapped[int] = mapped_column(Integer, nullable=False)
    os_family: Mapped[OsFamily | None] = mapped_column(os_family_enum, nullable=True)
    os_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    os_distribution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    os_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    business_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    technical_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pmp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    backup_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    backup_location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ha_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    last_patch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_vuln_scan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    security_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    decommission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    health_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_verified_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    updated_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User] = relationship(foreign_keys=[updated_by_id])
    disks: Mapped[list["VmDisk"]] = relationship(
        back_populates="vm", cascade="all, delete-orphan", order_by="VmDisk.sort_order"
    )
    networks: Mapped[list["VmNetwork"]] = relationship(
        back_populates="vm", cascade="all, delete-orphan", order_by="VmNetwork.sort_order"
    )
    applications: Mapped[list["VmApplication"]] = relationship(
        back_populates="vm", cascade="all, delete-orphan", order_by="VmApplication.app_name"
    )
    audit_entries: Mapped[list["AuditLog"]] = relationship(
        back_populates="vm", cascade="all, delete-orphan"
    )

def compute_health_score(vm: "Vm") -> int:
    score = 0
    if vm.description:
        score += 10
    if vm.business_owner or vm.technical_owner or vm.owner:
        score += 15
    if vm.applications:
        score += 20
    if vm.networks:
        score += 15
    if vm.disks:
        score += 15
    if vm.monitoring_enabled:
        score += 10
    if vm.decommission_date:
        score += 15
    return score



Index(
    "uq_vms_platform_external_id",
    Vm.platform,
    Vm.external_id,
    unique=True,
    postgresql_where=Vm.external_id.is_not(None),
)
Index(
    "uq_vms_platform_name_without_external_id",
    Vm.platform,
    func.lower(Vm.name),
    unique=True,
    postgresql_where=Vm.external_id.is_(None),
)
Index("ix_vms_platform", Vm.platform)
Index("ix_vms_cluster", Vm.cluster)
Index("ix_vms_status", Vm.status)
Index("ix_vms_criticality", Vm.criticality)
Index("ix_vms_lifecycle", Vm.lifecycle)
Index("ix_vms_vm_type", Vm.vm_type)
Index("ix_vms_environment", Vm.environment)
Index("ix_vms_monitoring_enabled", Vm.monitoring_enabled)


class VmDisk(Base):
    __tablename__ = "vm_disks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="CASCADE"), nullable=False
    )
    disk_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    vm: Mapped[Vm] = relationship(back_populates="disks")


class VmNetwork(Base):
    __tablename__ = "vm_networks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="CASCADE"), nullable=False
    )
    ip_address: Mapped[str] = mapped_column(String(50), nullable=False)
    vlan: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gateway: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    vm: Mapped[Vm] = relationship(back_populates="networks")


class VmApplication(Base):
    __tablename__ = "vm_applications"
    __table_args__ = (
        UniqueConstraint("vm_id", "app_name", name="uq_vm_applications_vm_app"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="CASCADE"), nullable=False
    )
    app_name: Mapped[str] = mapped_column(String(255), nullable=False)
    app_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    vm: Mapped[Vm] = relationship(back_populates="applications")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vms.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )

    vm: Mapped[Vm] = relationship(back_populates="audit_entries")
    user: Mapped[User] = relationship()


Index("ix_audit_log_vm_id_changed_at", AuditLog.vm_id, AuditLog.changed_at)


class DropdownOption(Base, TimestampMixin):
    __tablename__ = "dropdown_options"
    __table_args__ = (
        UniqueConstraint("category", "value", name="uq_dropdown_category_value"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category: Mapped[DropdownCategory] = mapped_column(
        Enum(DropdownCategory, name="dropdown_category"), nullable=False
    )
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    family: Mapped[OsFamily | None] = mapped_column(os_family_enum, nullable=True)


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
