import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.core.config import get_settings
from app.db.models import VmAttachment, now_utc
from app.schemas.vms import AttachmentRead
from app.services.vms import get_vm_or_404

ALLOWED_MIME = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
    "application/zip",
}
MAX_BYTES = 50 * 1024 * 1024  # 50 MB

# Magic-byte → set of valid claimed MIME types for that signature
_MAGIC: list[tuple[bytes, frozenset[str]]] = [
    (b"%PDF", frozenset({"application/pdf"})),
    (b"\x89PNG", frozenset({"image/png"})),
    (b"\xff\xd8", frozenset({"image/jpeg"})),
    (b"PK\x03\x04", frozenset({
        "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })),
]

_EXT: dict[str, str] = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/zip": ".zip",
}


def _magic_matches(data: bytes, claimed: str) -> bool:
    for magic, valid_types in _MAGIC:
        if data.startswith(magic):
            return claimed in valid_types
    return False

router = APIRouter()


@router.get("", response_model=list[AttachmentRead])
def list_attachments(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list[VmAttachment]:
    get_vm_or_404(db, vm_id)
    return list(db.scalars(
        select(VmAttachment).where(VmAttachment.vm_id == vm_id).order_by(VmAttachment.created_at.desc())
    ))


@router.post("", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    vm_id: uuid.UUID, file: UploadFile, db: DbSession, current_user: EditorUser, _: Csrf
) -> VmAttachment:
    get_vm_or_404(db, vm_id)
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File type not allowed: {file.content_type}")
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds 50 MB limit")
    claimed_type = file.content_type or ""
    if not _magic_matches(content, claimed_type):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File content does not match declared type")

    settings = get_settings()
    attach_id = uuid.uuid4()
    dest_dir = Path(settings.upload_dir) / str(vm_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(file.filename or "upload").stem[:128] or "upload"
    safe_name = f"{stem}{_EXT.get(claimed_type, '')}"
    dest = dest_dir / f"{attach_id}_{safe_name}"
    dest.write_bytes(content)

    attachment = VmAttachment(
        id=attach_id,
        vm_id=vm_id,
        filename=safe_name,
        file_path=str(dest.relative_to(settings.upload_dir)),
        file_size=len(content),
        mime_type=file.content_type or "application/octet-stream",
        uploaded_by_id=current_user.id,
        created_at=now_utc(),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{attachment_id}/download")
def download_attachment(
    vm_id: uuid.UUID, attachment_id: uuid.UUID, db: DbSession, _: ViewerUser
) -> FileResponse:
    att = db.scalar(select(VmAttachment).where(VmAttachment.id == attachment_id, VmAttachment.vm_id == vm_id))
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    file_path = Path(get_settings().upload_dir) / att.file_path
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk")
    return FileResponse(str(file_path), filename=att.filename, media_type=att.mime_type)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    vm_id: uuid.UUID, attachment_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
) -> None:
    att = db.scalar(select(VmAttachment).where(VmAttachment.id == attachment_id, VmAttachment.vm_id == vm_id))
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    file_path = Path(get_settings().upload_dir) / att.file_path
    if file_path.exists():
        file_path.unlink()
    db.delete(att)
    db.commit()
