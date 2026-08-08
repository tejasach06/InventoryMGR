from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models import AuditLog, NetworkRole, UserRole, VmApplication, VmNetwork, VmStatus

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

def test_shutdown_stale_filter(client, db_session: Session) -> None:
    editor = create_user(db_session, email="stale_editor@example.local", role=UserRole.editor)
    stale_vm = create_vm_row(db_session, editor, name="stale-off", status=VmStatus.powered_off)
    fresh_vm = create_vm_row(db_session, editor, name="fresh-off", status=VmStatus.powered_off)
    create_vm_row(db_session, editor, name="running-vm", status=VmStatus.running)

    now = datetime.now(UTC)
    db_session.add(
        AuditLog(
            vm_id=stale_vm.id,
            field_name="status",
            new_value="powered_off",
            changed_at=now - timedelta(days=100),
            user_id=editor.id,
        )
    )
    db_session.add(
        AuditLog(
            vm_id=fresh_vm.id,
            field_name="status",
            new_value="powered_off",
            changed_at=now - timedelta(days=10),
            user_id=editor.id,
        )
    )
    db_session.commit()
    login(client, "stale_editor@example.local")

    res_true = client.get("/api/vms", params={"shutdown_stale": "true"})
    assert res_true.status_code == 200
    assert {item["name"] for item in res_true.json()["items"]} == {"stale-off"}

    res_false = client.get("/api/vms", params={"shutdown_stale": "false"})
    assert res_false.status_code == 200
    assert {item["name"] for item in res_false.json()["items"]} == {"fresh-off", "running-vm"}


def test_decommission_overdue_filter(client, db_session: Session) -> None:
    editor = create_user(db_session, email="decom_editor@example.local", role=UserRole.editor)
    today = datetime.now(UTC).date()
    create_vm_row(
        db_session, editor, name="overdue-vm", decommission_date=today - timedelta(days=5), status=VmStatus.running
    )
    create_vm_row(
        db_session, editor, name="decom-done", decommission_date=today - timedelta(days=5), status=VmStatus.decommissioned
    )
    create_vm_row(
        db_session, editor, name="future-vm", decommission_date=today + timedelta(days=5), status=VmStatus.running
    )
    login(client, "decom_editor@example.local")

    res_true = client.get("/api/vms", params={"decommission_overdue": "true"})
    assert res_true.status_code == 200
    assert {item["name"] for item in res_true.json()["items"]} == {"overdue-vm"}

    res_false = client.get("/api/vms", params={"decommission_overdue": "false"})
    assert res_false.status_code == 200
    assert {item["name"] for item in res_false.json()["items"]} == {"decom-done", "future-vm"}


def test_missing_ip_filter_and_tag_parity(client, db_session: Session) -> None:
    editor = create_user(db_session, email="ip_editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="no-ip-vm")
    has_ip_vm = create_vm_row(db_session, editor, name="has-ip-vm")
    create_vm_row(db_session, editor, name="template-no-ip", tags=["template"])

    db_session.add(VmNetwork(vm_id=has_ip_vm.id, ip_address="10.0.0.1", role=NetworkRole.private))
    db_session.commit()
    login(client, "ip_editor@example.local")

    res_true = client.get("/api/vms", params={"missing_ip": "true"})
    assert res_true.status_code == 200
    # Includes template_no_ip because raw filter intentionally does NOT exclude tags
    assert {item["name"] for item in res_true.json()["items"]} == {"no-ip-vm", "template-no-ip"}

    res_false = client.get("/api/vms", params={"missing_ip": "false"})
    assert res_false.status_code == 200
    assert {item["name"] for item in res_false.json()["items"]} == {"has-ip-vm"}
