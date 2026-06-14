from pydantic import BaseModel, Field


class MempalaceSearchHit(BaseModel):
    title: str
    path: str
    page_type: str | None = None
    line: int
    snippet: str


class MempalaceSearchResult(BaseModel):
    query: str
    total: int = Field(ge=0)
    items: list[MempalaceSearchHit]
