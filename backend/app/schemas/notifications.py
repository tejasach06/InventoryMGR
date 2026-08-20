import uuid
from datetime import date

from pydantic import BaseModel

from app.db.models import NetworkRole


class DueVmRead(BaseModel):
    vm_id: uuid.UUID
    name: str
    decommission_date: date
    days_remaining: int
    unread: bool


class AckRequest(BaseModel):
    vm_ids: list[uuid.UUID] | None = None

class DuplicateIpVm(BaseModel):
    vm_id: uuid.UUID
    name: str


class DuplicateIpRead(BaseModel):
    ip_address: str
    role: NetworkRole
    vms: list[DuplicateIpVm]
