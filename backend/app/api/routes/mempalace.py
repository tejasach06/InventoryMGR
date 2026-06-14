from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ViewerUser
from app.core.config import get_settings
from app.schemas.mempalace import MempalaceSearchResult
from app.services.mempalace import search_wiki

router = APIRouter()


@router.get("/search", response_model=MempalaceSearchResult)
def search_mempalace(
    _: ViewerUser,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> MempalaceSearchResult:
    query = " ".join(q.split())
    items = search_wiki(get_settings().mempalace_vault_path, query, limit)
    return MempalaceSearchResult(query=query, total=len(items), items=items)
