from sqlalchemy.orm import Session

from app.db.models import AppSetting

NOTIFY_DAYS_KEY = "decommission_notify_days"
DEFAULT_NOTIFY_DAYS = 30

WARN_PCT_KEY = "storage_usage_warn_pct"
DEFAULT_WARN_PCT = 85


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
