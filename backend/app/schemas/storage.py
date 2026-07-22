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


class ShareCreate(BaseModel):
    export_path: str = Field(min_length=1, max_length=500)
    used_gb: int | None = Field(default=None, ge=0)
    allowed_clients: str | None = None
    notes: str | None = None
    sort_order: int = 0


class ShareUpdate(BaseModel):
    export_path: str | None = Field(default=None, min_length=1, max_length=500)
    used_gb: int | None = Field(default=None, ge=0)
    allowed_clients: str | None = None
    notes: str | None = None
    sort_order: int | None = None


class ShareRead(ShareCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    volume_id: uuid.UUID


class VolumeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    capacity_gb: int = Field(default=0, ge=0)
    used_gb: int = Field(default=0, ge=0)
    notes: str | None = None
    sort_order: int = 0


class VolumeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    capacity_gb: int | None = Field(default=None, ge=0)
    used_gb: int | None = Field(default=None, ge=0)
    notes: str | None = None
    sort_order: int | None = None


class VolumeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    array_id: uuid.UUID
    name: str
    capacity_gb: int
    used_gb: int
    notes: str | None
    sort_order: int


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
    shares: list[ShareRead]


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
