from sqlalchemy.orm import Session

from app.db.models import NetworkRole, UserRole, VmApplication, VmNetwork

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

    response = client.get("/api/vms", params={"application": "payroll", "application_op": "eq"})

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


def test_node_neq_includes_vms_with_unset_node(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="node-a", node="pve-a")
    create_vm_row(db_session, editor, name="node-unset", node=None)
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"node": "pve-a", "node_op": "neq"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"node-unset"}


def test_os_family_neq_includes_vms_with_unset_os_family(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="os-linux", os_family="linux")
    create_vm_row(db_session, editor, name="os-unset", os_family=None)
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"os_family": "linux", "os_family_op": "neq"})

    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"os-unset"}


def test_ip_role_filter_matches_vms_having_that_role(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    public_vm = create_vm_row(db_session, editor, name="Public VM", external_id=None)
    private_vm = create_vm_row(db_session, editor, name="Private VM", external_id=None)
    db_session.add(VmNetwork(vm_id=public_vm.id, ip_address="203.0.113.4", role=NetworkRole.public))
    db_session.add(VmNetwork(vm_id=private_vm.id, ip_address="10.0.0.5", role=NetworkRole.private))
    db_session.commit()
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"ip_role": "public"})

    assert response.status_code == 200, response.text
    names = [item["name"] for item in response.json()["items"]]
    assert names == ["Public VM"]


def test_ip_role_filter_lists_a_multi_ip_vm_once(client, db_session: Session) -> None:
    """EXISTS rather than a join: two matching IPs must not duplicate the row."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Two Public", external_id=None)
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="203.0.113.4", role=NetworkRole.public))
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="203.0.113.5", role=NetworkRole.public))
    db_session.commit()
    login(client, "editor@example.local")

    response = client.get("/api/vms", params={"ip_role": "public"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["name"] for item in body["items"]] == ["Two Public"]
    assert body["total"] == 1
