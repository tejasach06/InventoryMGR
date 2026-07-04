from sqlalchemy.orm import Session

from app.db.models import UserRole, VmApplication

from .conftest import create_user, create_vm_row, login


def test_criticality_eq_default_matches_only_exact_value(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="crit-high", criticality="high")
    create_vm_row(db_session, editor, name="crit-medium", criticality="medium")
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"criticality": "high"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"crit-high"}


def test_criticality_neq_excludes_the_given_value(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="crit-high", criticality="high")
    create_vm_row(db_session, editor, name="crit-medium", criticality="medium")
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"criticality": "high", "criticality_op": "neq"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"crit-medium"}


def test_application_defaults_to_contains_without_explicit_operator(
    client, db_session: Session
) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="app-host")
    db_session.add(VmApplication(vm_id=vm.id, app_name="Payroll Service"))
    db_session.commit()
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"application": "payroll"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"app-host"}


def test_application_eq_requires_exact_match(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="app-host")
    db_session.add(VmApplication(vm_id=vm.id, app_name="Payroll Service"))
    db_session.commit()
    login(client, "editor@example.local")

    response = client.get(
        "/api/vms", params={"application": "payroll", "application_op": "eq"}
    )

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_tag_contains_operator_matches_tag_membership(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="tagged", tags=["web", "prod"])
    create_vm_row(db_session, editor, name="untagged", tags=["db"])
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"tag": "web", "tag_op": "contains"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"tagged"}


def test_owner_neq_excludes_across_owner_columns(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="alice-vm", owner="alice")
    create_vm_row(db_session, editor, name="bob-vm", owner="bob")
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"owner": "alice", "owner_op": "neq"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"bob-vm"}
