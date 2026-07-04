from sqlalchemy.orm import Session

from app.db.models import Lifecycle, UserRole, Vm, VmType

from .conftest import auth_headers, create_user, create_vm_row, login, vm_payload


def test_create_temporary_vm_with_decommission_date_sets_lifecycle_retiring(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    payload = vm_payload(vm_type="temporary", decommission_date="2026-12-31", lifecycle="active")

    response = client.post("/api/vms", json=payload, headers=auth_headers(csrf))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["vm_type"] == "temporary"
    assert body["lifecycle"] == "retiring"


def test_updating_permanent_vm_to_temporary_with_decommission_date_updates_lifecycle(
    client, db_session: Session
) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, vm_type=VmType.permanent, lifecycle=Lifecycle.active)
    csrf = login(client, "editor@example.local")

    response = client.patch(
        f"/api/vms/{vm.id}",
        json={"vm_type": "temporary", "decommission_date": "2026-12-31"},
        headers=auth_headers(csrf),
    )

    assert response.status_code == 200, response.text
    assert response.json()["lifecycle"] == "retiring"
    db_session.refresh(vm)
    assert vm.lifecycle == Lifecycle.retiring


def test_permanent_vm_without_decommission_date_keeps_supplied_lifecycle(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    payload = vm_payload(vm_type="permanent", lifecycle="active")

    response = client.post("/api/vms", json=payload, headers=auth_headers(csrf))

    assert response.status_code == 201, response.text
    assert response.json()["lifecycle"] == "active"


def test_create_vm_without_vm_type_defaults_to_permanent(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    response = client.post("/api/vms", json=vm_payload(), headers=auth_headers(csrf))

    assert response.status_code == 201, response.text
    assert response.json()["vm_type"] == "permanent"


def test_vm_type_column_exists_on_model(db_session: Session) -> None:
    assert "vm_type" in {col.name for col in Vm.__table__.columns}
