import uuid
from datetime import UTC, datetime, timedelta

from app.db.models import AuditLog, UserRole, VmNetwork
from tests.conftest import auth_headers, create_user, create_vm_row, login


def test_dashboard_alerts(client, db_session):
    user = create_user(db_session, email="alerts_user@example.com", role=UserRole.viewer)
    csrf = login(client, "alerts_user@example.com")
    headers = auth_headers(csrf)

    now = datetime.now(UTC)
    today = now.date()

    # 1. Shutdown Stale: VM powered off > 90 days
    vm_stale = create_vm_row(
        db_session,
        user=user,
        name="stale-vm",
        status="powered_off",
        tags=["prod"],
    )
    # Insert AuditLog entry 100 days ago
    audit1 = AuditLog(
        id=uuid.uuid4(),
        vm_id=vm_stale.id,
        user_id=user.id,
        field_name="status",
        old_value="running",
        new_value="powered_off",
        changed_at=now - timedelta(days=100),
    )
    db_session.add(audit1)

    # VM powered off recently (10 days ago) - should NOT appear in shutdown_stale
    vm_recent_off = create_vm_row(
        db_session,
        user=user,
        name="recent-off-vm",
        status="powered_off",
    )
    audit2 = AuditLog(
        id=uuid.uuid4(),
        vm_id=vm_recent_off.id,
        user_id=user.id,
        field_name="status",
        old_value="running",
        new_value="powered_off",
        changed_at=now - timedelta(days=10),
    )
    db_session.add(audit2)

    # VM powered off > 90 days but tagged template - should be excluded
    vm_template = create_vm_row(
        db_session,
        user=user,
        name="template-vm",
        status="powered_off",
        tags=["Template"],
    )
    audit3 = AuditLog(
        id=uuid.uuid4(),
        vm_id=vm_template.id,
        user_id=user.id,
        field_name="status",
        old_value="running",
        new_value="powered_off",
        changed_at=now - timedelta(days=100),
    )
    db_session.add(audit3)

    # 2. Decommission Overdue: past decommission_date and not decommissioned
    vm_overdue = create_vm_row(
        db_session,
        user=user,
        name="overdue-vm",
        status="running",
        decommission_date=today - timedelta(days=5),
    )
    vm_decommed = create_vm_row(
        db_session,
        user=user,
        name="decommed-vm",
        status="decommissioned",
        decommission_date=today - timedelta(days=5),
    )

    # 3. Missing IP: no networks
    net1 = VmNetwork(id=uuid.uuid4(), vm_id=vm_stale.id, ip_address="10.0.0.1")
    net2 = VmNetwork(id=uuid.uuid4(), vm_id=vm_overdue.id, ip_address="10.0.0.2")
    net3 = VmNetwork(id=uuid.uuid4(), vm_id=vm_recent_off.id, ip_address="10.0.0.3")
    net4 = VmNetwork(id=uuid.uuid4(), vm_id=vm_decommed.id, ip_address="10.0.0.4")
    db_session.add_all([net1, net2, net3, net4])

    vm_no_ip = create_vm_row(
        db_session,
        user=user,
        name="no-ip-vm",
        status="running",
    )
    vm_no_ip_backup = create_vm_row(
        db_session,
        user=user,
        name="backup-no-ip-vm",
        status="running",
        tags=["backup"],
    )

    db_session.commit()

    response = client.get("/api/dashboard", headers=headers)
    assert response.status_code == 200
    data = response.json()

    # Verify shutdown_stale
    shutdown_stale = data["shutdown_stale"]
    stale_ids = [item["id"] for item in shutdown_stale]
    assert str(vm_stale.id) in stale_ids
    assert str(vm_recent_off.id) not in stale_ids
    assert str(vm_template.id) not in stale_ids
    stale_item = next(i for i in shutdown_stale if i["id"] == str(vm_stale.id))
    assert stale_item["days"] >= 100

    # Verify decommission_overdue
    decommission_overdue = data["decommission_overdue"]
    overdue_ids = [item["id"] for item in decommission_overdue]
    assert str(vm_overdue.id) in overdue_ids
    assert str(vm_decommed.id) not in overdue_ids
    overdue_item = next(i for i in decommission_overdue if i["id"] == str(vm_overdue.id))
    assert overdue_item["days"] == 5

    # Verify missing_ip
    missing_ip = data["missing_ip"]
    missing_ids = [item["id"] for item in missing_ip]
    assert str(vm_no_ip.id) in missing_ids
    assert str(vm_no_ip_backup.id) not in missing_ids
    assert str(vm_stale.id) not in missing_ids
