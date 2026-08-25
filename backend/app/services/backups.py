import os
import re
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import BackupJob
from app.services import app_settings

BACKUP_SUFFIX = ".dump"
DUMP_MAGIC = b"PGDMP"  # first 5 bytes of pg_dump -Fc output
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
FILENAME_RE = re.compile(r"^inventorymgr-\d{8}T\d{6}Z-[a-z_]+\.dump$")


class BackupError(Exception):
    pass


def libpq_url() -> str:
    """Return libpq-compatible connection URL with +psycopg driver prefix removed."""
    url = get_settings().database_url
    return url.replace("+psycopg", "")


def backup_dir() -> Path:
    """Return resolved backup directory, creating it if it doesn't exist."""
    path = Path(get_settings().backup_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_path(filename: str) -> Path:
    """Validate filename against strict regex and return existing file path in backup_dir."""
    if not FILENAME_RE.match(filename):
        raise FileNotFoundError(f"Invalid backup filename: {filename}")
    path = backup_dir() / filename
    if not path.is_file():
        raise FileNotFoundError(f"Backup file not found: {filename}")
    return path


def list_backups() -> list[dict]:
    """List all *.dump backups in backup_dir sorted newest first."""
    b_dir = backup_dir()
    dumps: list[dict] = []
    for entry in b_dir.glob("*.dump"):
        if entry.is_file() and FILENAME_RE.match(entry.name):
            try:
                st = entry.stat()
                dumps.append(
                    {
                        "name": entry.name,
                        "size_bytes": st.st_size,
                        "created_at": datetime.fromtimestamp(st.st_mtime, tz=UTC),
                    }
                )
            except OSError:
                continue
    dumps.sort(key=lambda d: d["created_at"], reverse=True)
    return dumps


def require_writable_dir() -> Path:
    """Return backup_dir, raising BackupError if it is not writable by this process."""
    path = backup_dir()
    if not os.access(path, os.W_OK | os.X_OK):
        raise BackupError(
            f"Backup directory {path} is not writable by uid {os.geteuid()}. "
            f"Fix ownership on the host mount (chown -R {os.geteuid()} <host dir>) "
            f"or set BACKUP_DIR to a writable path."
        )
    return path


def run_dump(db: Session, *, kind: str, user_id: uuid.UUID | None) -> BackupJob:
    """Run pg_dump custom format to backup_dir and track in BackupJob."""
    now = datetime.now(UTC)
    filename = f"inventorymgr-{now:%Y%m%dT%H%M%SZ}-{kind}{BACKUP_SUFFIX}"
    path = require_writable_dir() / filename
    job = BackupJob(
        kind=kind,
        status="running",
        filename=filename,
        user_id=user_id,
        started_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    settings = get_settings()
    pg_bin = settings.pg_bin_dir
    pg_dump = os.path.join(pg_bin, "pg_dump") if pg_bin else "pg_dump"

    try:
        proc = subprocess.run(
            [pg_dump, "--format=custom", "--no-owner", "--no-privileges", f"--file={path}", libpq_url()],
            capture_output=True,
            text=True,
            timeout=3600,
        )
    except FileNotFoundError:
        path.unlink(missing_ok=True)
        job.status = "failed"
        job.error = "pg_dump not found on system PATH"
        job.finished_at = datetime.now(UTC)
        db.commit()
        raise BackupError("pg_dump not found on system PATH") from None
    except Exception as exc:
        path.unlink(missing_ok=True)
        job.status = "failed"
        job.error = str(exc)[-2000:]
        job.finished_at = datetime.now(UTC)
        db.commit()
        raise BackupError(str(exc)) from exc

    if proc.returncode != 0:
        path.unlink(missing_ok=True)
        job.status = "failed"
        err_msg = (proc.stderr or "")[-2000:]
        job.error = err_msg
        job.finished_at = datetime.now(UTC)
        db.commit()
        raise BackupError(err_msg or f"pg_dump exited with code {proc.returncode}")

    job.size_bytes = path.stat().st_size
    job.status = "success"
    job.finished_at = datetime.now(UTC)
    db.commit()
    db.refresh(job)
    return job


def prune(db: Session, retention: int) -> int:
    """Delete oldest *.dump files beyond retention limit."""
    # ponytail: retention is count-based; prune oldest *.dump beyond retention
    if retention < 1:
        retention = 7
    files = [p for p in backup_dir().glob("*.dump") if FILENAME_RE.match(p.name) and p.is_file()]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    deleted = 0
    for f in files[retention:]:
        try:
            f.unlink(missing_ok=True)
            deleted += 1
        except OSError:
            pass
    return deleted


def restore_dump(db: Session, upload_path: Path, *, user_id: uuid.UUID) -> BackupJob:
    """Restore database from custom-format dump file in strict 5-step order."""
    # 1. Pre-restore backup
    run_dump(db, kind="pre_restore", user_id=user_id)
    db.commit()
    db.close()

    from app.db.session import SessionLocal, engine

    engine.dispose()
    # 2. pg_restore
    settings = get_settings()
    pg_bin = settings.pg_bin_dir
    pg_restore = os.path.join(pg_bin, "pg_restore") if pg_bin else "pg_restore"

    now = datetime.now(UTC)
    try:
        proc = subprocess.run(
            [
                pg_restore,
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-privileges",
                f"--dbname={libpq_url()}",
                str(upload_path),
            ],
            capture_output=True,
            text=True,
            timeout=3600,
        )
    except FileNotFoundError:
        raise BackupError("pg_restore not found on system PATH") from None
    except Exception as exc:
        raise BackupError(str(exc)) from exc

    restore_stderr = proc.stderr or ""

    # 3. Dispose engine pool
    from app.db.session import engine

    engine.dispose()

    # 4. Alembic upgrade head
    backend_dir = Path(__file__).resolve().parents[2]
    env = {**os.environ, "DATABASE_URL": settings.database_url}
    alembic_proc = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        timeout=600,
        env=env,
    )
    if alembic_proc.returncode != 0:
        err_msg = alembic_proc.stderr or f"Alembic upgrade failed with code {alembic_proc.returncode}"
        raise BackupError(f"Alembic upgrade head failed: {err_msg[-2000:]}")

    # 5. Fresh session write
    with SessionLocal() as fresh_db:
        status = "success"
        error_val = restore_stderr[-2000:] if restore_stderr else None
        job = BackupJob(
            kind="restore",
            status=status,
            filename=upload_path.name,
            size_bytes=upload_path.stat().st_size if upload_path.exists() else None,
            error=error_val,
            user_id=user_id,
            started_at=now,
            finished_at=datetime.now(UTC),
        )
        fresh_db.add(job)
        app_settings.bump_session_epoch(fresh_db)
        fresh_db.commit()
        fresh_db.refresh(job)
        return job
