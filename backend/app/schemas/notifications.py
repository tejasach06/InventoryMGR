import uuid
from datetime import date

from pydantic import BaseModel


class DueVmRead(BaseModel):
    vm_id: uuid.UUID
    name: str
    decommission_date: date
    days_remaining: int
    unread: bool


class AckRequest(BaseModel):
    vm_ids: list[uuid.UUID] | None = None
