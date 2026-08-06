from typing import Literal

from pydantic import BaseModel


AccentId = Literal["orange", "blue", "violet", "emerald", "rose", "amber"]
DEFAULT_ACCENT: AccentId = "orange"


class AccentPreference(BaseModel):
    accent: AccentId


class ColumnPreference(BaseModel):
    key: str
    visible: bool
    order: int


class ColumnPreferencesRead(BaseModel):
    columns: list[ColumnPreference]
