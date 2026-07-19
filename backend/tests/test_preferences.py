import re
from pathlib import Path

from sqlalchemy.orm import Session

from app.api.routes.preferences import DEFAULT_COLUMNS
from app.db.models import UserRole

from .conftest import auth_headers, create_user, login

FRONTEND_HOOK = (
    Path(__file__).resolve().parents[2] / "frontend/src/hooks/useColumnPreferences.ts"
)


def test_frontend_default_columns_match_the_backend() -> None:
    """The two lists are hand-maintained duplicates. Drift silently breaks columns:
    a key the backend serves but the frontend cannot label, or vice versa."""
    source = FRONTEND_HOOK.read_text()
    block = source.split("DEFAULT_COLUMNS: ColumnConfig[] = [", 1)[1].split("];", 1)[0]
    frontend = [
        (key, visible == "true", int(order))
        for key, visible, order in re.findall(
            r"key: '([^']+)', visible: (true|false), order: (\d+)", block
        )
    ]
    backend = [(c["key"], c["visible"], c["order"]) for c in DEFAULT_COLUMNS]

    assert frontend == backend

    labels = source.split("COLUMN_LABELS: Record<string, string> = {", 1)[1].split("};", 1)[0]
    labelled = set(re.findall(r"(\w+):", labels))
    assert {c["key"] for c in DEFAULT_COLUMNS} <= labelled


def test_default_columns_include_new_optional_keys(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    login(client, "viewer@example.com")

    response = client.get("/api/user/preferences/inventory")
    assert response.status_code == 200
    columns = {c["key"]: c for c in response.json()["columns"]}
    assert columns["name"]["visible"] is True
    for key in ("fqdn", "owner", "pmp_enabled", "cluster", "tags"):
        assert key in columns
    assert columns["fqdn"]["visible"] is False


def test_put_accepts_new_column_keys(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, "viewer@example.com")

    payload = {
        "columns": [
            {"key": "name", "visible": True, "order": 0},
            {"key": "fqdn", "visible": True, "order": 1},
            {"key": "owner", "visible": True, "order": 2},
        ]
    }
    response = client.put(
        "/api/user/preferences/inventory", json=payload, headers=auth_headers(csrf)
    )
    assert response.status_code == 200, response.text


def test_put_rejects_unknown_column_key(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, "viewer@example.com")

    payload = {"columns": [{"key": "bogus", "visible": True, "order": 0}]}
    response = client.put(
        "/api/user/preferences/inventory", json=payload, headers=auth_headers(csrf)
    )
    assert response.status_code == 422


def test_saved_ip_address_reads_back_as_private_ip(client, db_session: Session) -> None:
    """ip_address predates roles. Saved layouts must survive, not duplicate or reset."""
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, "viewer@example.com")

    payload = {
        "columns": [
            {"key": "name", "visible": True, "order": 0},
            {"key": "ip_address", "visible": True, "order": 6},
        ]
    }
    response = client.put(
        "/api/user/preferences/inventory", json=payload, headers=auth_headers(csrf)
    )
    assert response.status_code == 200, response.text

    response = client.get("/api/user/preferences/inventory")
    assert response.status_code == 200
    columns = response.json()["columns"]
    keys = [c["key"] for c in columns]

    # Rewritten on read, keeping its slot and visibility.
    assert "ip_address" not in keys
    assert keys.count("private_ip") == 1
    private_ip = next(c for c in columns if c["key"] == "private_ip")
    assert private_ip["visible"] is True
    assert private_ip["order"] == 6

    # The merge must not also append private_ip as a new hidden column, which
    # would make the layout unsaveable on the duplicate-key check.
    response = client.put(
        "/api/user/preferences/inventory", json={"columns": columns}, headers=auth_headers(csrf)
    )
    assert response.status_code == 200, response.text


def test_role_ip_columns_are_valid_keys(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, "viewer@example.com")

    payload = {
        "columns": [
            {"key": "private_ip", "visible": True, "order": 6},
            {"key": "public_ip", "visible": False, "order": 7},
            {"key": "backup_ip", "visible": False, "order": 8},
        ]
    }
    response = client.put(
        "/api/user/preferences/inventory", json=payload, headers=auth_headers(csrf)
    )
    assert response.status_code == 200, response.text


def test_saved_prefs_are_merged_with_newly_added_columns(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, "viewer@example.com")

    # Simulate prefs saved before the new columns existed.
    payload = {
        "columns": [
            {"key": "name", "visible": True, "order": 0},
            {"key": "status", "visible": True, "order": 1},
        ]
    }
    response = client.put(
        "/api/user/preferences/inventory", json=payload, headers=auth_headers(csrf)
    )
    assert response.status_code == 200

    response = client.get("/api/user/preferences/inventory")
    assert response.status_code == 200
    columns = {c["key"]: c for c in response.json()["columns"]}
    # Saved entries preserved.
    assert columns["name"]["visible"] is True
    # New keys appended as hidden, ordered after saved ones.
    assert columns["fqdn"]["visible"] is False
    assert columns["fqdn"]["order"] > columns["status"]["order"]


def test_layout_holding_both_ip_address_and_private_ip_stays_saveable(
    client, db_session: Session
) -> None:
    """The legacy rewrite must not mint a duplicate key.

    ip_address rewrites to private_ip on read. A layout already containing both
    collapsed into two identical private_ip entries, and every later save then
    failed the duplicate-key check with no way for the UI to recover.
    """
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    saved = client.put(
        "/api/user/preferences/inventory",
        json={
            "columns": [
                {"key": "ip_address", "visible": True, "order": 6},
                {"key": "private_ip", "visible": False, "order": 7},
            ]
        },
        headers=auth_headers(csrf),
    )
    assert saved.status_code == 200, saved.text

    response = client.get("/api/user/preferences/inventory")
    assert response.status_code == 200, response.text
    columns = response.json()["columns"]
    assert [c["key"] for c in columns].count("private_ip") == 1

    # The first entry wins, so the legacy column keeps its position and visibility.
    private_ip = next(c for c in columns if c["key"] == "private_ip")
    assert private_ip == {"key": "private_ip", "visible": True, "order": 6}

    # What the client just read must be saveable again.
    resaved = client.put(
        "/api/user/preferences/inventory",
        json={"columns": columns},
        headers=auth_headers(csrf),
    )
    assert resaved.status_code == 200, resaved.text
