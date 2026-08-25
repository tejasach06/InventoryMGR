import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BackupFileRead(BaseModel):
    name: str
    size_bytes: int
    created_at: datetime


class BackupJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: str
    filename: str | None = None
    size_bytes: int | None = None
    error: str | None = None
    user_id: uuid.UUID | None = None
    started_at: datetime
    finished_at: datetime | None = None


class BackupSettings(BaseModel):
    enabled: bool
    hour_utc: int
    retention: int


class BackupSettingsUpdate(BaseModel):
    enabled: bool | None = None
    hour_utc: int | None = Field(default=None, ge=0, le=23)
    retention: int | None = Field(default=None, ge=1, le=365)


class BackupsOverview(BaseModel):
    backups: list[BackupFileRead]
    jobs: list[BackupJobRead]
    settings: BackupSettings
