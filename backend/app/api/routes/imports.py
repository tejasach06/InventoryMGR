import csv
import io
import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.schemas.imports import ImportBatchRead, ImportCommitRequest, ImportCommitResult
from app.services.csv_import import (
    TEMPLATE_COLUMNS,
    TEMPLATE_SAMPLE_ROWS,
    commit_batch,
    create_preview_batch,
    load_batch_or_404,
)

router = APIRouter()

ALLOWED_CSV_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel"}


@router.post("/preview", response_model=ImportBatchRead, status_code=status.HTTP_201_CREATED)
async def preview_import(
    db: DbSession,
    current_user: EditorUser,
    _: Csrf,
    file: Annotated[UploadFile, File()],
    full_inventory: Annotated[bool, Form()] = False,
) -> object:
    if file.content_type not in ALLOWED_CSV_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV upload must use text/csv content type",
        )
    content = await file.read()
    return create_preview_batch(
        db,
        filename=file.filename or "upload.csv",
        content=content,
        user=current_user,
        full_inventory=full_inventory,
    )


@router.get("/template", response_class=PlainTextResponse)
def download_template(current_user: ViewerUser) -> PlainTextResponse:
    """Serve every importable column, grouped left-to-right, plus sample rows."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(TEMPLATE_COLUMNS)
    for sample in TEMPLATE_SAMPLE_ROWS:
        writer.writerow([sample[column] for column in TEMPLATE_COLUMNS])
    return PlainTextResponse(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vm-import-template.csv"'},
    )


@router.get("/{batch_id}", response_model=ImportBatchRead)
def get_import(batch_id: uuid.UUID, db: DbSession, current_user: ViewerUser) -> object:
    return load_batch_or_404(db, batch_id, current_user)


@router.post("/{batch_id}/commit", response_model=ImportCommitResult)
def commit_import(
    batch_id: uuid.UUID,
    db: DbSession,
    current_user: EditorUser,
    _: Csrf,
    payload: ImportCommitRequest | None = None,
) -> dict[str, int]:
    return commit_batch(
        db,
        batch_id=batch_id,
        user=current_user,
        confirm_decommission=bool(payload and payload.confirm_decommission),
    )
