from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, UserRole, Vm, compute_health_score
from tests.conftest import auth_headers, create_user, create_vm_row, login


def test_bulk_update_by_ids_writes_audit_rows(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    first = create_vm_row(db_session, user, name="bulk-01", criticality="low")
    second = create_vm_row(db_session, user, name="bulk-02", criticality="low")
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"ids": [str(first.id), str(second.id)], "patch": {"criticality": "critical"}},
        headers=auth_headers(csrf),
    )

    assert response.status_code == 200
    assert response.json() == {"updated": 2, "failed": []}
    db_session.expire_all()
    assert {vm.criticality.value for vm in db_session.scalars(select(Vm))} == {"critical"}
    audit = db_session.scalars(select(AuditLog).where(AuditLog.field_name == "criticality")).all()
    assert len(audit) == 2


def test_bulk_update_by_filters_targets_the_filtered_set(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    create_vm_row(db_session, user, name="prod-01", environment="production", owner=None)
    create_vm_row(db_session, user, name="dev-01", environment="development", owner=None)
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"filters": {"environment": ["production"]}, "patch": {"owner": "ops"}},
        headers=auth_headers(csrf),
    )

    assert response.json()["updated"] == 1
    db_session.expire_all()
    owners = {vm.name: vm.owner for vm in db_session.scalars(select(Vm))}
    assert owners == {"prod-01": "ops", "dev-01": None}


def test_tags_are_added_and_removed_not_replaced(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="tagged-01", tags=["keep", "drop"])
    csrf = login(client, user.email)

    client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"tags_add": ["new"], "tags_remove": ["drop"]}},
        headers=auth_headers(csrf),
    )

    db_session.expire_all()
    assert sorted(db_session.get(Vm, vm.id).tags) == ["keep", "new"]


def test_health_score_is_recomputed(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="health-01", owner=None, business_owner=None)
    before = vm.health_score
    csrf = login(client, user.email)

    client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"owner": "ops", "business_owner": "finance"}},
        headers=auth_headers(csrf),
    )

    db_session.expire_all()
    assert db_session.get(Vm, vm.id).health_score > before


def test_viewer_is_forbidden_and_missing_csrf_is_rejected(
    client: TestClient, db_session: Session
) -> None:
    viewer = create_user(db_session, email="viewer@example.com", role="viewer")
    vm = create_vm_row(db_session, viewer, name="rbac-01")
    csrf = login(client, viewer.email)

    forbidden = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"status": "running"}},
        headers=auth_headers(csrf),
    )
    assert forbidden.status_code == 403

    editor = create_user(db_session, email="editor@example.com", role="editor")
    login(client, editor.email)
    no_csrf = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {"status": "running"}},
    )
    assert no_csrf.status_code == 403


def test_both_or_neither_target_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="target-01")
    csrf = login(client, user.email)

    assert client.post(
        "/api/vms/bulk",
        json={"patch": {"status": "running"}},
        headers=auth_headers(csrf),
    ).status_code == 422
    assert client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "filters": {}, "patch": {"status": "running"}},
        headers=auth_headers(csrf),
    ).status_code == 422


def test_empty_patch_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="editor@example.com", role="editor")
    vm = create_vm_row(db_session, user, name="nochange-01")
    csrf = login(client, user.email)

    response = client.post(
        "/api/vms/bulk",
        json={"ids": [str(vm.id)], "patch": {}},
        headers=auth_headers(csrf),
    )

    assert response.status_code == 422


def test_template_vm_health_score_is_zero(db_session: Session) -> None:
    user = create_user(db_session, email="template-health@example.com", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        user,
        name="template-health",
        tags=["Template"],
        description="complete",
        owner="ops",
        monitoring_enabled=True,
        decommission_date="2026-12-31",
    )

    assert compute_health_score(vm) == 0
