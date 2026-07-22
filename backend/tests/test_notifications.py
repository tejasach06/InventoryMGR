from datetime import date, timedelta

from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, create_vm_row, login


def _due(client):
    return client.get("/api/notifications/decommissions").json()


def test_lists_within_window_and_overdue(client, db_session):
    user = create_user(db_session, email="v@example.com", role=UserRole.viewer)
    today = date.today()
    create_vm_row(db_session, user, name="soon", decommission_date=today + timedelta(days=5))
    create_vm_row(db_session, user, name="overdue", decommission_date=today - timedelta(days=2))
    create_vm_row(db_session, user, name="far", decommission_date=today + timedelta(days=90))
    login(client, "v@example.com")
    names = {row["name"]: row for row in _due(client)}
    assert set(names) == {"soon", "overdue"}
    assert names["overdue"]["days_remaining"] == -2
    assert names["soon"]["unread"] is True


def test_excludes_retired_and_decommissioned(client, db_session):
    user = create_user(db_session, email="v2@example.com", role=UserRole.viewer)
    today = date.today()
    create_vm_row(
        db_session,
        user,
        name="retired",
        decommission_date=today + timedelta(days=1),
        lifecycle="retired",
    )
    create_vm_row(
        db_session,
        user,
        name="gone",
        decommission_date=today + timedelta(days=1),
        status="decommissioned",
    )
    login(client, "v2@example.com")
    assert _due(client) == []


def test_ack_marks_read_and_resurfaces_on_date_change(client, db_session):
    user = create_user(db_session, email="v3@example.com", role=UserRole.viewer)
    today = date.today()
    vm = create_vm_row(db_session, user, name="x", decommission_date=today + timedelta(days=3))
    csrf = login(client, "v3@example.com")

    client.post(
        "/api/notifications/decommissions/ack", json={"vm_ids": None}, headers=auth_headers(csrf)
    )
    assert _due(client)[0]["unread"] is False

    vm.decommission_date = today + timedelta(days=7)
    db_session.commit()
    assert _due(client)[0]["unread"] is True


def test_ack_requires_csrf(client, db_session):
    create_user(db_session, email="v4@example.com", role=UserRole.viewer)
    login(client, "v4@example.com")
    r = client.post("/api/notifications/decommissions/ack", json={"vm_ids": None})
    assert r.status_code == 403
