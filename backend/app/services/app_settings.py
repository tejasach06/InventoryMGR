import time

from sqlalchemy.orm import Session

from app.db.models import AppSetting

NOTIFY_DAYS_KEY = "decommission_notify_days"
DEFAULT_NOTIFY_DAYS = 30

WARN_PCT_KEY = "storage_usage_warn_pct"
DEFAULT_WARN_PCT = 85

BACKUP_ENABLED_KEY = "backup_schedule_enabled"
DEFAULT_BACKUP_ENABLED = False

BACKUP_HOUR_KEY = "backup_schedule_hour_utc"
DEFAULT_BACKUP_HOUR = 2

BACKUP_RETENTION_KEY = "backup_retention"
DEFAULT_BACKUP_RETENTION = 7

SESSION_EPOCH_KEY = "session_epoch"
DEFAULT_SESSION_EPOCH = 0


def get_notify_days(db: Session) -> int:
    row = db.get(AppSetting, NOTIFY_DAYS_KEY)
    if row is None:
        return DEFAULT_NOTIFY_DAYS
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_NOTIFY_DAYS


def set_notify_days(db: Session, days: int) -> int:
    row = db.get(AppSetting, NOTIFY_DAYS_KEY)
    if row is None:
        row = AppSetting(key=NOTIFY_DAYS_KEY, value=str(days))
        db.add(row)
    else:
        row.value = str(days)
    db.commit()
    return days


def get_warn_pct(db: Session) -> int:
    row = db.get(AppSetting, WARN_PCT_KEY)
    if row is None:
        return DEFAULT_WARN_PCT
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_WARN_PCT


def set_warn_pct(db: Session, pct: int) -> int:
    row = db.get(AppSetting, WARN_PCT_KEY)
    if row is None:
        row = AppSetting(key=WARN_PCT_KEY, value=str(pct))
        db.add(row)
    else:
        row.value = str(pct)
    db.commit()
    return pct

def get_backup_enabled(db: Session) -> bool:
    row = db.get(AppSetting, BACKUP_ENABLED_KEY)
    if row is None:
        return DEFAULT_BACKUP_ENABLED
    return row.value.strip().lower() in ("true", "1", "yes")


def set_backup_enabled(db: Session, enabled: bool) -> bool:
    val_str = "true" if enabled else "false"
    row = db.get(AppSetting, BACKUP_ENABLED_KEY)
    if row is None:
        row = AppSetting(key=BACKUP_ENABLED_KEY, value=val_str)
        db.add(row)
    else:
        row.value = val_str
    db.commit()
    return enabled


def get_backup_hour(db: Session) -> int:
    row = db.get(AppSetting, BACKUP_HOUR_KEY)
    if row is None:
        return DEFAULT_BACKUP_HOUR
    try:
        val = int(row.value)
        return val if 0 <= val <= 23 else DEFAULT_BACKUP_HOUR
    except ValueError:
        return DEFAULT_BACKUP_HOUR


def set_backup_hour(db: Session, hour: int) -> int:
    row = db.get(AppSetting, BACKUP_HOUR_KEY)
    if row is None:
        row = AppSetting(key=BACKUP_HOUR_KEY, value=str(hour))
        db.add(row)
    else:
        row.value = str(hour)
    db.commit()
    return hour


def get_backup_retention(db: Session) -> int:
    row = db.get(AppSetting, BACKUP_RETENTION_KEY)
    if row is None:
        return DEFAULT_BACKUP_RETENTION
    try:
        val = int(row.value)
        return val if val >= 1 else DEFAULT_BACKUP_RETENTION
    except ValueError:
        return DEFAULT_BACKUP_RETENTION


def set_backup_retention(db: Session, retention: int) -> int:
    row = db.get(AppSetting, BACKUP_RETENTION_KEY)
    if row is None:
        row = AppSetting(key=BACKUP_RETENTION_KEY, value=str(retention))
        db.add(row)
    else:
        row.value = str(retention)
    db.commit()
    return retention


def get_session_epoch(db: Session) -> int:
    row = db.get(AppSetting, SESSION_EPOCH_KEY)
    if row is None:
        return DEFAULT_SESSION_EPOCH
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_SESSION_EPOCH


def bump_session_epoch(db: Session) -> int:
    epoch = int(time.time())
    row = db.get(AppSetting, SESSION_EPOCH_KEY)
    if row is None:
        row = AppSetting(key=SESSION_EPOCH_KEY, value=str(epoch))
        db.add(row)
    else:
        row.value = str(epoch)
    db.commit()
    return epoch
