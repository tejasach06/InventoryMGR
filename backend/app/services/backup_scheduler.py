import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.db.models import BackupJob
from app.db.session import SessionLocal
from app.services import app_settings
from app.services import backups as backups_service

logger = logging.getLogger(__name__)

LOCK_KEY = 8_273_641_905  # arbitrary fixed bigint for pg_advisory_lock
TICK_SECONDS = 300


def _tick() -> None:
    """Single scheduler tick for automated database backup."""
    db = SessionLocal()
    locked = False
    try:
        if not app_settings.get_backup_enabled(db):
            return

        res = db.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}
        ).scalar()
        locked = bool(res)
        if not locked:
            return

        now = datetime.now(UTC)
        target_hour = app_settings.get_backup_hour(db)

        last_job = db.scalars(
            select(BackupJob)
            .where(
                BackupJob.kind.in_(("manual", "scheduled")),
                BackupJob.status == "success",
            )
            .order_by(BackupJob.started_at.desc())
            .limit(1)
        ).first()

        run = False
        if last_job is None:
            run = True
        else:
            gap = now - last_job.started_at
            if gap >= timedelta(hours=36):
                run = True
            elif gap >= timedelta(hours=23) and now.hour == target_hour:
                run = True

        if run:
            backups_service.run_dump(db, kind="scheduled", user_id=None)
            backups_service.prune(db, app_settings.get_backup_retention(db))
    except Exception:
        logger.exception("Backup scheduler tick failed")
    finally:
        if locked:
            try:
                db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            except Exception:
                logger.exception("Failed to release backup scheduler advisory lock")
        db.close()


async def scheduler_loop() -> None:
    """Background scheduler loop sleeping TICK_SECONDS between ticks."""
    while True:
        try:
            await asyncio.sleep(TICK_SECONDS)
            await asyncio.to_thread(_tick)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Backup scheduler loop unhandled error")
