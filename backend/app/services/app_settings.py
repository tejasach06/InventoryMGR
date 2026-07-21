from sqlalchemy.orm import Session

from app.db.models import AppSetting

NOTIFY_DAYS_KEY = "decommission_notify_days"
DEFAULT_NOTIFY_DAYS = 30


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
