from pydantic import BaseModel, Field


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
