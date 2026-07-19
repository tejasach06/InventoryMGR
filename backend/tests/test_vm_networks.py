from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import NetworkRole, UserRole, VmNetwork
from tests.conftest import auth_headers, create_user, create_vm_row, login, vm_payload


def test_network_defaults_to_private_role(db_session: Session) -> None:
    """Roles backfill and default to private, so pre-role rows stay meaningful."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Roled VM", external_id=None)
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", sort_order=0))
    db_session.commit()

    network = db_session.scalar(select(VmNetwork).where(VmNetwork.vm_id == vm.id))
    assert network is not None
    assert network.role == NetworkRole.private


def test_vm_create_round_trips_network_roles(client: TestClient, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    payload = vm_payload(name="Multi Role")
    payload["networks"] = [
        {"ip_address": "10.0.0.5", "role": "private", "sort_order": 0},
        {"ip_address": "203.0.113.4", "role": "public", "sort_order": 1},
    ]
    response = client.post("/api/vms", json=payload, headers=auth_headers(csrf))
    assert response.status_code == 201, response.text

    roles = {n["ip_address"]: n["role"] for n in response.json()["networks"]}
    assert roles == {"10.0.0.5": "private", "203.0.113.4": "public"}


def test_clone_preserves_network_roles(client: TestClient, db_session: Session) -> None:
    """Clone rebuilds children field by field; a missed field silently resets."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Clone Source", external_id=None)
    db_session.add(
        VmNetwork(vm_id=vm.id, ip_address="203.0.113.4", role=NetworkRole.public, sort_order=0)
    )
    db_session.commit()
    csrf = login(client, "editor@example.local")

    response = client.post(f"/api/vms/{vm.id}/clone", headers=auth_headers(csrf))
    assert response.status_code == 201, response.text
    assert response.json()["networks"][0]["role"] == "public"
