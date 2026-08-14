import pytest
from fastapi import HTTPException, status

from app.api.routes.users import delete_user
from app.db.models import AuditLog, UserRole
from tests.conftest import auth_headers, create_user, create_vm_row, login


def test_admin_deletes_fresh_viewer(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    viewer = create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, admin.email)

    response = client.delete(f"/api/users/{viewer.id}", headers=auth_headers(csrf))

    assert response.status_code == status.HTTP_204_NO_CONTENT
    users = client.get("/api/users").json()
    assert "viewer@example.com" not in {user["email"] for user in users}


def test_admin_cannot_delete_own_account(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    csrf = login(client, admin.email)

    response = client.delete(f"/api/users/{admin.id}", headers=auth_headers(csrf))

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["detail"] == "You cannot delete your own account"


def test_delete_user_refuses_last_active_admin_guard(db_session):
    target = create_user(db_session, email="first-admin@example.com", role=UserRole.admin)
    current = create_user(
        db_session, email="inactive-admin@example.com", role=UserRole.admin, is_active=False
    )

    with pytest.raises(HTTPException) as exc_info:
        delete_user(target.id, db_session, current, None)

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert exc_info.value.detail == "Cannot remove the last active admin"


def test_viewer_cannot_delete_user(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    viewer = create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    csrf = login(client, viewer.email)

    response = client.delete(f"/api/users/{admin.id}", headers=auth_headers(csrf))

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_delete_user_requires_csrf(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    viewer = create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    login(client, admin.email)

    response = client.delete(f"/api/users/{viewer.id}")

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_delete_user_with_linked_audit_log_returns_conflict(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    linked_user = create_user(db_session, email="linked@example.com", role=UserRole.editor)
    vm = create_vm_row(db_session, admin)
    db_session.add(
        AuditLog(
            vm_id=vm.id,
            user_id=linked_user.id,
            field_name="name",
            old_value="old",
            new_value="new",
        )
    )
    db_session.commit()
    csrf = login(client, admin.email)

    response = client.delete(f"/api/users/{linked_user.id}", headers=auth_headers(csrf))

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["detail"] == (
        "User has linked records (audit log, imports). Deactivate the account instead."
    )
    users = client.get("/api/users").json()
    assert "linked@example.com" in {user["email"] for user in users}
