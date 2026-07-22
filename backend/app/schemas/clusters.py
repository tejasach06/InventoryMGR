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
