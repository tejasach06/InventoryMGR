import csv
import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.schemas.imports import ImportBatchRead, ImportCommitResult
from app.services.csv_import import (
    ALL_HEADERS,
    REQUIRED_HEADERS,
    REQUIRED_HEADERS_ORDER,
    commit_batch,
    create_preview_batch,
    load_batch_or_404,
)

router = APIRouter()

ALLOWED_CSV_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel"}


def _looks_like_csv(content: bytes) -> bool:
    try:
        sample = content[:4096].decode("utf-8")
    except UnicodeDecodeError:
        return False
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        return False
    return dialect.delimiter in (",", ";", "\t")


@router.post("/preview", response_model=ImportBatchRead, status_code=status.HTTP_201_CREATED)
async def preview_import(
    db: DbSession,
    current_user: EditorUser,
    _: Csrf,
    file: Annotated[UploadFile, File()],
) -> object:
    if file.content_type not in ALLOWED_CSV_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV upload must use text/csv content type",
        )
    content = await file.read()
    if not _looks_like_csv(content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not appear to be valid CSV",
        )
    return create_preview_batch(
        db, filename=file.filename or "upload.csv", content=content, user=current_user
    )


@router.get("/template", response_class=PlainTextResponse)
def download_template(current_user: ViewerUser) -> PlainTextResponse:
    """Serve the CSV header row, derived from the same set the importer accepts."""
    ordered = list(REQUIRED_HEADERS_ORDER) + sorted(ALL_HEADERS - REQUIRED_HEADERS)
    return PlainTextResponse(
        ",".join(ordered) + "\n",
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vm-import-template.csv"'},
    )


@router.get("/{batch_id}", response_model=ImportBatchRead)
def get_import(batch_id: uuid.UUID, db: DbSession, current_user: ViewerUser) -> object:
    return load_batch_or_404(db, batch_id, current_user)


@router.post("/{batch_id}/commit", response_model=ImportCommitResult)
def commit_import(
    batch_id: uuid.UUID, db: DbSession, current_user: EditorUser, _: Csrf
) -> dict[str, int]:
    return commit_batch(db, batch_id=batch_id, user=current_user)
