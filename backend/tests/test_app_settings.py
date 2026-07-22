from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login


def test_get_defaults_to_30(client, db_session):
    create_user(db_session, email="v@example.com", role=UserRole.viewer)
    login(client, "v@example.com")
    r = client.get("/api/settings/app")
    assert r.status_code == 200
    assert r.json()["decommission_notify_days"] == 30


def test_admin_updates_days(client, db_session):
    create_user(db_session, email="admin@example.com", role=UserRole.admin)
    csrf = login(client, "admin@example.com")
    r = client.patch(
        "/api/settings/app",
        json={"decommission_notify_days": 45},
        headers=auth_headers(csrf),
    )
    assert r.status_code == 200
    assert r.json()["decommission_notify_days"] == 45
    assert client.get("/api/settings/app").json()["decommission_notify_days"] == 45


def test_non_admin_patch_forbidden(client, db_session):
    create_user(db_session, email="e@example.com", role=UserRole.editor)
    csrf = login(client, "e@example.com")
    r = client.patch(
        "/api/settings/app", json={"decommission_notify_days": 10}, headers=auth_headers(csrf)
    )
    assert r.status_code == 403


def test_patch_requires_csrf(client, db_session):
    create_user(db_session, email="admin2@example.com", role=UserRole.admin)
    login(client, "admin2@example.com")
    r = client.patch("/api/settings/app", json={"decommission_notify_days": 10})
    assert r.status_code == 403


def test_rejects_non_positive(client, db_session):
    create_user(db_session, email="admin3@example.com", role=UserRole.admin)
    csrf = login(client, "admin3@example.com")
    r = client.patch(
        "/api/settings/app", json={"decommission_notify_days": 0}, headers=auth_headers(csrf)
    )
    assert r.status_code == 422
