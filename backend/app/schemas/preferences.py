from pydantic import BaseModel


class ColumnPreference(BaseModel):
    key: str
    visible: bool
    order: int


class ColumnPreferencesRead(BaseModel):
    columns: list[ColumnPreference]
