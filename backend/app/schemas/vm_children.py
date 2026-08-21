import uuid
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.core.ip_utils import normalize_ip
from app.db.models import NetworkRole

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

class DiskUpdate(BaseModel):
    disk_name: str | None = None
    storage_name: str | None = None
    size_gb: int | None = Field(default=None, ge=0)
    storage_type: str | None = None
    sort_order: int | None = None

class NetworkCreate(BaseModel):
    ip_address: str = Field(..., max_length=64)
    @field_validator("ip_address", mode="after")
    @classmethod
    def _normalize_ip(cls, v: str) -> str:
        return normalize_ip(v)
    role: NetworkRole = NetworkRole.private
    sort_order: int = 0

class NetworkRead(NetworkCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID

class NetworkUpdate(BaseModel):
    ip_address: str | None = Field(None, max_length=64)
    @field_validator("ip_address", mode="after")
    @classmethod
    def _normalize_ip(cls, v: str | None) -> str | None:
        return normalize_ip(v) if v else v
    role: NetworkRole | None = None
    sort_order: int | None = None

class ApplicationCreate(BaseModel):
    app_name: str
    app_owner: str | None = None
    description: str | None = None

class ApplicationRead(ApplicationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vm_id: uuid.UUID

class ApplicationUpdate(BaseModel):
    app_name: str | None = None
    app_owner: str | None = None
    description: str | None = None
