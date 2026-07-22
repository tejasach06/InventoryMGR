import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import DropdownCategory, OsFamily


class DropdownOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: DropdownCategory
    value: str
    family: OsFamily | None = None


class DropdownOptionCreate(BaseModel):
    category: DropdownCategory
    value: str = Field(..., min_length=1, max_length=255)
    family: OsFamily | None = None

    def normalized_value(self) -> str:
        return self.value.strip()


class DropdownOptionUpdate(BaseModel):
    value: str = Field(..., min_length=1, max_length=255)
    family: OsFamily | None = None

    def normalized_value(self) -> str:
        return self.value.strip()


class GroupedDropdownOptions(BaseModel):
    cpu: list[str] = Field(default_factory=list)
    datacenter: list[str] = Field(default_factory=list)
    disk: list[str] = Field(default_factory=list)
    os: list[str] = Field(default_factory=list)
    cluster: list[str] = Field(default_factory=list)
    os_by_family: dict[str, list[str]] = Field(default_factory=dict)


class AppSettingsRead(BaseModel):
    decommission_notify_days: int
    storage_usage_warn_pct: int


class AppSettingsUpdate(BaseModel):
    decommission_notify_days: int | None = Field(default=None, ge=1, le=3650)
    storage_usage_warn_pct: int | None = Field(default=None, ge=1, le=100)
