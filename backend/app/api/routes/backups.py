import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import AdminUser, Csrf, DbSession
from app.api.routes.auth import _clear_auth_cookies
from app.db.models import BackupJob
from app.schemas.backups import (
    BackupFileRead,
    BackupJobRead,
    BackupSettings,
    BackupSettingsUpdate,
    BackupsOverview,
)
from app.services import app_settings
from app.services import backups as backups_service

router = APIRouter()


@router.get("", response_model=BackupsOverview)
def get_backups_overview(db: DbSession, _: AdminUser) -> BackupsOverview:
    backup_files = [BackupFileRead(**d) for d in backups_service.list_backups()]
    recent_jobs = db.scalars(
        select(BackupJob).order_by(BackupJob.started_at.desc()).limit(20)
    ).all()
    settings = BackupSettings(
        enabled=app_settings.get_backup_enabled(db),
        hour_utc=app_settings.get_backup_hour(db),
        retention=app_settings.get_backup_retention(db),
    )
    return BackupsOverview(
        backups=backup_files,
        jobs=[BackupJobRead.model_validate(j) for j in recent_jobs],
        settings=settings,
    )


@router.post("", response_model=BackupJobRead, status_code=status.HTTP_201_CREATED)
def create_backup(db: DbSession, current_user: AdminUser, __: Csrf) -> BackupJobRead:
    try:
        job = backups_service.run_dump(db, kind="manual", user_id=current_user.id)
        backups_service.prune(db, app_settings.get_backup_retention(db))
        return BackupJobRead.model_validate(job)
    except backups_service.BackupError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.get("/{filename}/download")
def download_backup(filename: str, _: AdminUser) -> FileResponse:
    try:
        path = backups_service.resolve_path(filename)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found"
        ) from None
    return FileResponse(
        path, media_type="application/octet-stream", filename=filename
    )


@router.delete("/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_backup(filename: str, _: AdminUser, __: Csrf) -> Response:
    try:
        path = backups_service.resolve_path(filename)
        path.unlink(missing_ok=True)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found"
        ) from None


@router.patch("/settings", response_model=BackupSettings)
def update_backup_settings(
    payload: BackupSettingsUpdate, db: DbSession, _: AdminUser, __: Csrf
) -> BackupSettings:
    if payload.enabled is not None:
        app_settings.set_backup_enabled(db, payload.enabled)
    if payload.hour_utc is not None:
        app_settings.set_backup_hour(db, payload.hour_utc)
    if payload.retention is not None:
        app_settings.set_backup_retention(db, payload.retention)
    return BackupSettings(
        enabled=app_settings.get_backup_enabled(db),
        hour_utc=app_settings.get_backup_hour(db),
        retention=app_settings.get_backup_retention(db),
    )


@router.post("/restore", response_model=BackupJobRead)
async def restore_backup(
    file: Annotated[UploadFile, File()],
    confirm: Annotated[str, Form()],
    response: Response,
    db: DbSession,
    current_user: AdminUser,
    __: Csrf,
) -> BackupJobRead:
    if confirm != "RESTORE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Type RESTORE to confirm"
        )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".dump")
    tmp_path = Path(tmp.name)
    total_bytes = 0
    try:
        header = await file.read(5)
        if header != backups_service.DUMP_MAGIC:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Not a pg_dump custom-format archive",
            )
        tmp.write(header)
        total_bytes += len(header)

        while chunk := await file.read(1024 * 1024):
            total_bytes += len(chunk)
            if total_bytes > backups_service.MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Backup file exceeds 2 GiB",
                )
            tmp.write(chunk)
        tmp.flush()
        tmp.close()

        job = backups_service.restore_dump(db, tmp_path, user_id=current_user.id)
        _clear_auth_cookies(response)
        return BackupJobRead.model_validate(job)
    except backups_service.BackupError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    finally:
        try:
            tmp.close()
        except Exception:
            pass
        tmp_path.unlink(missing_ok=True)
