import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models import (
    Criticality,
    Environment,
    NetworkRole,
    OsFamily,
    Platform,
    VmStatus,
    VmType,
)

STRING_FIELDS = {
    "external_id",
    "name",
    "fqdn",
    "description",
    "datacenter",
    "sr_id",
    "cluster",
    "node",
    "os_distribution",
    "os_version",
    "owner",
    "business_owner",
    "technical_owner",
    "backup_location",
    "security_remarks",
}
REQUIRED_STRINGS = {"name", "cluster"}


def _strip_or_none(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class VmBase(BaseModel):
    external_id: str | None = None
    name: str | None = None
    fqdn: str | None = None
    description: str | None = None
    platform: Platform | None = None
    datacenter: str | None = None
    sr_id: str | None = Field(default=None, max_length=50)
    cluster: str | None = None
    node: str | None = None
    status: VmStatus | None = None
    environment: Environment | None = None
    cpu_cores: int | None = Field(default=None, ge=0)
    memory_mb: int | None = Field(default=None, ge=0)
    os_family: OsFamily | None = None
    os_distribution: str | None = None
    os_version: str | None = None
    owner: str | None = None
    business_owner: str | None = None
    technical_owner: str | None = None
    pmp_enabled: bool | None = None
    monitoring_enabled: bool | None = None
    backup_enabled: bool | None = None
    backup_location: str | None = None
    ha_enabled: bool | None = None
    criticality: Criticality | None = None
    vm_type: VmType | None = None
    tags: list[str] | None = None
    last_patch_date: date | None = None
    last_vuln_scan_date: date | None = None
    security_remarks: str | None = None
    decommission_date: date | None = None
    last_verified_at: date | None = None
    disks: Sequence["DiskCreate"] = []
    networks: Sequence["NetworkCreate"] = []

    @field_validator(
        "platform",
        "status",
        "criticality",
        "os_family",
        "environment",
        "vm_type",
        mode="before",
    )
    @classmethod
    def lowercase_enums(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator(*STRING_FIELDS, mode="before", check_fields=False)
    @classmethod
    def strip_strings(cls, value: Any) -> Any:
        return _strip_or_none(value)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> Any:
        if value is None:
            return value
        if not isinstance(value, list):
            raise ValueError("tags must be a list of strings")
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]


class VmCreate(VmBase):
    name: str
    platform: Platform
    cluster: str
    status: VmStatus
    environment: Environment = Environment.production
    cpu_cores: int = Field(ge=0)
    memory_mb: int = Field(ge=0)
    criticality: Criticality
    vm_type: VmType = VmType.permanent
    pmp_enabled: bool = False
    monitoring_enabled: bool = False
    backup_enabled: bool = False
    ha_enabled: bool = False
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def reject_blank_required(self) -> "VmCreate":
        for field in REQUIRED_STRINGS:
            if not getattr(self, field):
                raise ValueError(f"{field} is required and cannot be blank")
        return self


class VmUpdate(VmBase):
    @model_validator(mode="after")
    def reject_supplied_blank_required(self) -> "VmUpdate":
        for field in REQUIRED_STRINGS:
            if field in self.model_fields_set and not getattr(self, field):
                raise ValueError(f"{field} cannot be blank")
        return self


class DiskCreate(BaseModel):
    disk_name: str
    storage_name: str | None = None
    size_gb: int = Field(default=0, ge=0)
    storage_type: str | None = None
    sort_order: int = 0


class DiskRead(DiskCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID


class NetworkCreate(BaseModel):
    ip_address: str
    role: NetworkRole = NetworkRole.private
    sort_order: int = 0


class NetworkRead(NetworkCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID


class ApplicationCreate(BaseModel):
    app_name: str
    app_owner: str | None = None
    description: str | None = None


class ApplicationRead(ApplicationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID


class DiskUpdate(BaseModel):
    disk_name: str | None = None
    storage_name: str | None = None
    size_gb: int | None = Field(default=None, ge=0)
    storage_type: str | None = None
    sort_order: int | None = None


class NetworkUpdate(BaseModel):
    ip_address: str | None = None
    role: NetworkRole | None = None
    sort_order: int | None = None


class ApplicationUpdate(BaseModel):
    app_name: str | None = None
    app_owner: str | None = None
    description: str | None = None


class AuditUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID
    user_id: uuid.UUID
    user: AuditUserRead | None = None
    field_name: str
    old_value: str | None
    new_value: str | None
    changed_at: datetime


class VmRead(VmCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by_id: uuid.UUID
    updated_by_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    disks: list[DiskRead] = []
    networks: list[NetworkRead] = []
    applications: list[ApplicationRead] = []
    health_score: int = 0


class VmList(BaseModel):
    items: list[VmRead]
    total: int
    limit: int
    offset: int


class DashboardAlertVm(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    environment: Environment
    days: int
    detail: str | None = None

class ReportSummary(BaseModel):
    total_vms: int
    counts: dict[str, int]


class DashboardStats(BaseModel):
    total: int
    linux: int
    windows: int
    production: int
    development: int
    test_uat: int
    powered_off: int
    without_monitoring: int
    without_applications: int
    total_vcpu: int = 0
    total_memory_gb: float = 0.0
    total_disk_gb: float = 0.0
    by_status: dict[str, int] = Field(default_factory=dict)
    by_environment: dict[str, int] = Field(default_factory=dict)
    by_criticality: dict[str, int] = Field(default_factory=dict)
    by_os_family: dict[str, int] = Field(default_factory=dict)
    shutdown_stale: list[DashboardAlertVm]
    decommission_overdue: list[DashboardAlertVm]
    missing_ip: list[DashboardAlertVm]
    duplicate_ip: list[DashboardAlertVm]

class VmBulkFilters(BaseModel):
    """Body mirror of api/routes/vms.py::VmFilterParams.

    The route's filter set is a query dataclass and cannot be reused in a JSON
    body, so the field names are duplicated here deliberately; the bulk test
    asserts the two stay in step.
    """

    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    platform: list[Platform] | None = None
    cluster: list[str] | None = None
    status: list[VmStatus] | None = None
    environment: list[Environment] | None = None
    criticality: list[Criticality] | None = None
    monitoring_enabled: bool | None = None
    node: list[str] | None = None
    os_family: list[OsFamily] | None = None
    owner: list[str] | None = None
    pmp_enabled: bool | None = None
    tag: list[str] | None = None
    application: list[str] | None = None
    ip_role: list[NetworkRole] | None = None
    health: str | None = None
    shutdown_stale: bool | None = None
    decommission_overdue: bool | None = None
    missing_ip: bool | None = None
    duplicate_ip: bool | None = None

class VmBulkUpdate(BaseModel):
    """Fields safe to set across many VMs at once.

    Identity fields (name, fqdn, external_id, sr_id) are excluded: they are
    per-VM unique, so bulk-setting them collides. Tags are add/remove rather
    than replace — a replace across a page of VMs destroys per-VM tags.
    """

    model_config = ConfigDict(extra="forbid")

    status: VmStatus | None = None
    environment: Environment | None = None
    criticality: Criticality | None = None
    vm_type: VmType | None = None
    cluster: str | None = None
    node: str | None = None
    datacenter: str | None = None
    owner: str | None = None
    business_owner: str | None = None
    technical_owner: str | None = None
    pmp_enabled: bool | None = None
    monitoring_enabled: bool | None = None
    backup_enabled: bool | None = None
    ha_enabled: bool | None = None
    backup_location: str | None = None
    last_verified_at: date | None = None
    tags_add: list[str] = []
    tags_remove: list[str] = []


class VmBulkRequest(BaseModel):
    ids: list[uuid.UUID] | None = None
    filters: VmBulkFilters | None = None
    patch: VmBulkUpdate

    @model_validator(mode="after")
    def exactly_one_target(self) -> "VmBulkRequest":
        if (self.ids is None) == (self.filters is None):
            raise ValueError("supply exactly one of ids or filters")
        if self.ids is not None and not self.ids:
            raise ValueError("ids must not be empty")
        if not self.patch.model_fields_set:
            raise ValueError("patch must set at least one field")
        return self


class VmBulkFailure(BaseModel):
    id: uuid.UUID
    message: str


class VmBulkResult(BaseModel):
    updated: int
    failed: list[VmBulkFailure]
