import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models import Criticality, Lifecycle, Platform, VmStatus

STRING_FIELDS = {
    "external_id",
    "name",
    "environment",
    "datacenter",
    "cluster",
    "host",
    "os_name",
    "owner",
    "notes",
    "backup_status",
    "dr_tier",
}
REQUIRED_STRINGS = {"name", "environment", "cluster", "host"}


def _strip_or_none(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class VmBase(BaseModel):
    external_id: str | None = None
    name: str | None = None
    platform: Platform | None = None
    environment: str | None = None
    datacenter: str | None = None
    cluster: str | None = None
    host: str | None = None
    status: VmStatus | None = None
    cpu_cores: int | None = Field(default=None, ge=0)
    memory_mb: int | None = Field(default=None, ge=0)
    disk_gb: int | None = Field(default=None, ge=0)
    os_name: str | None = None
    ip_addresses: list[str] | None = None
    owner: str | None = None
    notes: str | None = None
    backup_status: str | None = None
    ha_enabled: bool | None = None
    dr_tier: str | None = None
    criticality: Criticality | None = None
    lifecycle: Lifecycle | None = None
    tags: list[str] | None = None
    last_verified_at: date | None = None

    @field_validator("platform", "status", "criticality", "lifecycle", mode="before")
    @classmethod
    def lowercase_enums(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator(*STRING_FIELDS, mode="before", check_fields=False)
    @classmethod
    def strip_strings(cls, value: Any) -> Any:
        return _strip_or_none(value)

    @field_validator("ip_addresses", "tags", mode="before")
    @classmethod
    def normalize_string_lists(cls, value: Any) -> Any:
        if value is None:
            return value
        if not isinstance(value, list):
            raise ValueError("must be a list of strings")
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]


class VmCreate(VmBase):
    name: str
    platform: Platform
    environment: str
    cluster: str
    host: str
    status: VmStatus
    cpu_cores: int = Field(ge=0)
    memory_mb: int = Field(ge=0)
    disk_gb: int = Field(ge=0)
    criticality: Criticality
    lifecycle: Lifecycle
    ha_enabled: bool = False
    ip_addresses: list[str] = Field(default_factory=list)
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


class VmRead(VmCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by_id: uuid.UUID
    updated_by_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class VmList(BaseModel):
    items: list[VmRead]
    total: int
    limit: int
    offset: int
