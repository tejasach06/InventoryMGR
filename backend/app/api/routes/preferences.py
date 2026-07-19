from fastapi import APIRouter, HTTPException, status

from app.api.deps import Csrf, CurrentUser, DbSession
from app.schemas.preferences import ColumnPreferencesRead

router = APIRouter()

DEFAULT_COLUMNS = [
    {"key": "name", "visible": True, "order": 0},
    {"key": "platform", "visible": True, "order": 1},
    {"key": "cluster", "visible": True, "order": 2},
    {"key": "status", "visible": True, "order": 3},
    {"key": "resources", "visible": True, "order": 4},
    {"key": "criticality", "visible": True, "order": 5},
    {"key": "private_ip", "visible": True, "order": 6},
    {"key": "updated_at", "visible": True, "order": 7},
    {"key": "fqdn", "visible": False, "order": 8},
    {"key": "environment", "visible": False, "order": 9},
    {"key": "lifecycle", "visible": False, "order": 10},
    {"key": "vm_type", "visible": False, "order": 11},
    {"key": "datacenter", "visible": False, "order": 12},
    {"key": "node", "visible": False, "order": 13},
    {"key": "os", "visible": False, "order": 14},
    {"key": "owner", "visible": False, "order": 15},
    {"key": "business_owner", "visible": False, "order": 16},
    {"key": "technical_owner", "visible": False, "order": 17},
    {"key": "pmp_enabled", "visible": False, "order": 18},
    {"key": "monitoring_enabled", "visible": False, "order": 19},
    {"key": "backup_enabled", "visible": False, "order": 20},
    {"key": "ha_enabled", "visible": False, "order": 21},
    {"key": "health_score", "visible": False, "order": 22},
    {"key": "tags", "visible": False, "order": 23},
    {"key": "created_at", "visible": False, "order": 24},
    {"key": "public_ip", "visible": False, "order": 25},
    {"key": "backup_ip", "visible": False, "order": 26},
]

# ip_address predates IP roles. Saved layouts still contain it, so reads rewrite
# it to private_ip in place — before the merge below, or the merge would append
# private_ip as a second entry and the duplicate check would reject the layout.
LEGACY_COLUMN_KEYS = {"ip_address": "private_ip"}

# Still accepted on write so a browser holding pre-deploy JS does not 422 mid-session.
ALL_COLUMN_KEYS = {c["key"] for c in DEFAULT_COLUMNS} | set(LEGACY_COLUMN_KEYS)


@router.get("/preferences/{page_key}", response_model=ColumnPreferencesRead)
def get_columns(page_key: str, user: CurrentUser) -> ColumnPreferencesRead:
    prefs = user.preferences or {}
    columns = prefs.get(f"columns_{page_key}")
    if not columns:
        return ColumnPreferencesRead(columns=DEFAULT_COLUMNS)
    for col in columns:
        col["key"] = LEGACY_COLUMN_KEYS.get(col["key"], col["key"])
    # Merge in columns added after the user saved their preferences.
    saved_keys = {c["key"] for c in columns}
    next_order = max((c["order"] for c in columns), default=-1) + 1
    for default in DEFAULT_COLUMNS:
        if default["key"] not in saved_keys:
            columns.append({"key": default["key"], "visible": False, "order": next_order})
            next_order += 1
    return ColumnPreferencesRead(columns=columns)


@router.put(
    "/preferences/{page_key}",
    response_model=ColumnPreferencesRead,
)
def update_columns(
    page_key: str,
    payload: ColumnPreferencesRead,
    user: CurrentUser,
    db: DbSession,
    _: Csrf,
) -> ColumnPreferencesRead:
    seen_keys: set[str] = set()
    for col in payload.columns:
        if col.key not in ALL_COLUMN_KEYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown column key: {col.key}",
            )
        if col.key in seen_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate column key: {col.key}",
            )
        seen_keys.add(col.key)

    prefs = dict(user.preferences or {})
    prefs[f"columns_{page_key}"] = [c.model_dump() for c in payload.columns]
    user.preferences = prefs
    db.commit()
    return ColumnPreferencesRead(columns=payload.columns)
