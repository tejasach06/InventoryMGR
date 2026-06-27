from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.db.models import User, UserRole

from .conftest import auth_headers, create_user, create_vm_row, login, vm_payload


def test_setup_creates_first_admin_sets_auth_cookies_and_then_locks(
    client, db_session: Session
) -> None:
    status_response = client.get("/api/auth/setup")
    assert status_response.status_code == 200
    assert status_response.json() == {"setup_required": True}

    setup_response = client.post(
        "/api/auth/setup",
        json={"email": "Bootstrap.Admin@Example.Local", "password": "bootstrap-password"},
    )

    assert setup_response.status_code == 201, setup_response.text
    assert setup_response.json()["user"]["email"] == "bootstrap.admin@example.local"
    assert setup_response.json()["user"]["role"] == "admin"
    assert client.cookies.get("inventorymgr_session")
    assert client.cookies.get("inventorymgr_csrf")
    users = list(db_session.scalars(select(User)).all())
    assert len(users) == 1
    assert users[0].email == "bootstrap.admin@example.local"
    assert users[0].role == UserRole.admin
    assert users[0].is_active is True
    assert verify_password("bootstrap-password", users[0].password_hash)

    completed_status = client.get("/api/auth/setup")
    assert completed_status.status_code == 200
    assert completed_status.json() == {"setup_required": False}

    second_setup = client.post(
        "/api/auth/setup",
        json={"email": "second.admin@example.local", "password": "another-password"},
    )
    assert second_setup.status_code == 409
    assert second_setup.json() == {"detail": "Setup has already been completed"}


def test_login_sets_session_and_csrf_cookies_and_requires_csrf_for_state_changes(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)

    response = client.post(
        "/api/auth/login",
        json={"email": "EDITOR@example.local", "password": "correct horse battery staple"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "editor@example.local"
    assert client.cookies.get("inventorymgr_session")
    csrf = client.cookies.get("inventorymgr_csrf")
    assert csrf

    missing_csrf = client.post("/api/vms", json=vm_payload())
    assert missing_csrf.status_code == 403

    created = client.post("/api/vms", json=vm_payload(), headers=auth_headers(csrf))
    assert created.status_code == 201, created.text

    logout_without_csrf = client.post("/api/auth/logout")
    assert logout_without_csrf.status_code == 403

    logout = client.post("/api/auth/logout", headers=auth_headers(csrf))
    assert logout.status_code == 204


def test_inventory_rbac_allows_viewer_read_editor_write_and_admin_delete(
    client, db_session: Session
) -> None:
    viewer = create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_user(db_session, email="root@example.local", role=UserRole.admin)
    existing_vm = create_vm_row(db_session, viewer, name="viewer-readable")
    viewer_csrf = login(client, "viewer@example.local")
    viewer_create = client.post(
        "/api/vms", json=vm_payload(name="viewer-denied"), headers=auth_headers(viewer_csrf)
    )
    viewer_update = client.patch(
        f"/api/vms/{existing_vm.id}",
        json={"notes": "viewer must not update"},
        headers=auth_headers(viewer_csrf),
    )
    assert viewer_update.status_code == 403
    viewer_delete = client.delete(f"/api/vms/{existing_vm.id}", headers=auth_headers(viewer_csrf))
    assert viewer_delete.status_code == 403
    assert viewer_create.status_code == 403
    assert client.get("/api/vms").status_code == 200

    client.post("/api/auth/logout", headers=auth_headers(viewer_csrf))
    editor_csrf = login(client, "editor@example.local")
    created = client.post(
        "/api/vms", json=vm_payload(name="editor-created"), headers=auth_headers(editor_csrf)
    )
    assert created.status_code == 201, created.text
    vm_id = created.json()["id"]

    patched = client.patch(
        f"/api/vms/{vm_id}",
        json={"notes": "updated by editor"},
        headers=auth_headers(editor_csrf),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["notes"] == "updated by editor"

    editor_delete = client.delete(f"/api/vms/{vm_id}", headers=auth_headers(editor_csrf))
    assert editor_delete.status_code == 403

    client.post("/api/auth/logout", headers=auth_headers(editor_csrf))
    admin_csrf = login(client, "root@example.local")
    admin_delete = client.delete(f"/api/vms/{vm_id}", headers=auth_headers(admin_csrf))
    assert admin_delete.status_code == 204

    user_create = client.post(
        "/api/users",
        json={
            "email": "new-viewer@example.local",
            "password": "long-enough",
            "role": "viewer",
            "is_active": True,
        },
        headers=auth_headers(admin_csrf),
    )
    assert user_create.status_code == 201, user_create.text


def test_duplicate_vm_identity_returns_409(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    first = client.post(
        "/api/vms", json=vm_payload(name="No External ID"), headers=auth_headers(csrf)
    )
    assert first.status_code == 201, first.text

    duplicate_name = client.post(
        "/api/vms",
        json=vm_payload(name="no external id", cpu_cores=2),
        headers=auth_headers(csrf),
    )
    assert duplicate_name.status_code == 409
    assert duplicate_name.json() == {"detail": "VM identity already exists"}

    with_external_id = client.post(
        "/api/vms",
        json=vm_payload(name="External A", external_id="vm-100"),
        headers=auth_headers(csrf),
    )
    assert with_external_id.status_code == 201, with_external_id.text

    duplicate_external_id = client.post(
        "/api/vms",
        json=vm_payload(name="External B", external_id="vm-100"),
        headers=auth_headers(csrf),
    )
    assert duplicate_external_id.status_code == 409
    assert duplicate_external_id.json() == {"detail": "VM identity already exists"}


def test_cannot_deactivate_or_demote_last_active_admin(client, db_session: Session) -> None:
    create_user(
        db_session,
        email="admin@example.local",
        password="change-me-before-use",
        role=UserRole.admin,
    )
    csrf = login(client, "admin@example.local", "change-me-before-use")
    users = client.get("/api/users").json()
    admin_id = next(user["id"] for user in users if user["email"] == "admin@example.local")

    deactivate = client.patch(
        f"/api/users/{admin_id}",
        json={"is_active": False},
        headers=auth_headers(csrf),
    )
    assert deactivate.status_code == 409
    assert deactivate.json()["detail"] == "Cannot remove the last active admin"

    demote = client.patch(
        f"/api/users/{admin_id}",
        json={"role": "editor"},
        headers=auth_headers(csrf),
    )
    assert demote.status_code == 409
    assert demote.json()["detail"] == "Cannot remove the last active admin"

    second_admin = client.post(
        "/api/users",
        json={
            "email": "second-admin@example.local",
            "password": "long-enough",
            "role": "admin",
            "is_active": True,
        },
        headers=auth_headers(csrf),
    )
    assert second_admin.status_code == 201, second_admin.text

    demote_after_second_admin = client.patch(
        f"/api/users/{admin_id}",
        json={"role": "editor"},
        headers=auth_headers(csrf),
    )
    assert demote_after_second_admin.status_code == 200
    assert demote_after_second_admin.json()["role"] == "editor"


def test_create_vm_with_multiple_disks_and_sr_id(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    created = client.post(
        "/api/vms",
        json=vm_payload(name="multi-disk", disk_gb=[50, 100, 150], sr_id="SR-2048"),
        headers=auth_headers(csrf),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["disk_gb"] == [50, 100, 150]
    assert body["sr_id"] == "SR-2048"

    fetched = client.get(f"/api/vms/{body['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["disk_gb"] == [50, 100, 150]
    assert fetched.json()["sr_id"] == "SR-2048"


def test_list_owners_returns_distinct_sorted_non_null(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="vm-a", owner="alice")
    create_vm_row(db_session, editor, name="vm-b", owner="bob", external_id="x1")
    create_vm_row(db_session, editor, name="vm-c", owner="alice", external_id="x2")
    create_vm_row(db_session, editor, name="vm-d", owner=None, external_id="x3")
    login(client, "editor@example.local")

    response = client.get("/api/vms/owners")

    assert response.status_code == 200, response.text
    assert response.json() == ["alice", "bob"]
