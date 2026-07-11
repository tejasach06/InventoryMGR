from sqlalchemy.orm import Session

from app.db.models import UserRole

from .conftest import auth_headers, create_user, login


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
