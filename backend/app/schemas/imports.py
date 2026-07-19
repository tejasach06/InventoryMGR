import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.db.models import ImportAction, ImportStatus


class ImportRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    row_number: int
    raw: dict[str, Any]
    normalized: dict[str, Any] | None
    action: ImportAction
    target_vm_id: uuid.UUID | None
    errors: list[dict[str, str]]
    changes: dict[str, list[Any]]
    created_at: datetime


class ImportBatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    created_by_id: uuid.UUID
    status: ImportStatus
    summary: dict[str, Any]
    ignored_columns: list[str]
    field_changes: dict[str, int]
    created_at: datetime
    committed_at: datetime | None
    rows: list[ImportRowRead]


class ImportCommitResult(BaseModel):
    created: int
    updated: int
