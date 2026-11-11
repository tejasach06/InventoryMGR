import pytest

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Criticality,
    NetworkRole,
    Platform,
    UserRole,
    VmApplication,
    VmNetwork,
)
from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmUpdate
from app.services.vm_filters import FilterOperator, list_vms
from app.services.vm_mutations import create_vm, update_vm
from app.services.vms import clone_vm

from .conftest import create_user, create_vm_row


def test_create_update_preserve_children_audit_and_health(db_session: Session) -> None:
    editor = create_user(db_session, email="vm-service@example.com", role=UserRole.editor)
    vm = create_vm(
        db_session,
        VmCreate(
            name="service-vm",
            platform="proxmox",
            cluster="pve-a",
            status="running",
            cpu_cores=4,
            memory_mb=8192,
            criticality="high",
            owner="ops",
            disks=[DiskCreate(disk_name="os", size_gb=80)],
            networks=[NetworkCreate(ip_address="10.0.0.5", role="private")],
        ),
        editor,
    )

    assert vm.health_score == 45
    updated = update_vm(
        db_session,
        vm,
        VmUpdate(owner="platform", monitoring_enabled=True, cpu_cores=8),
        editor,
    )

    assert updated.owner == "platform"
    assert updated.monitoring_enabled is True
    assert updated.cpu_cores == 8
    assert updated.health_score == 55
    assert [(disk.disk_name, disk.size_gb) for disk in updated.disks] == [("os", 80)]
    assert [(network.ip_address, network.role.value) for network in updated.networks] == [
        ("10.0.0.5", "private")
    ]
    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.vm_id == vm.id).order_by(AuditLog.field_name)
    ).all()
    assert [(entry.field_name, entry.old_value, entry.new_value) for entry in audits] == [
        ("cpu_cores", "4", "8"),
        ("monitoring_enabled", "False", "True"),
        ("owner", "ops", "platform"),
    ]


def test_clone_preserves_children_resets_identity_and_recomputes_health(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="clone-service@example.com", role=UserRole.editor)
    source = create_vm(
        db_session,
        VmCreate(
            name="clone-source",
            external_id="vm-200",
            platform="vmware",
            cluster="vc-a",
            status="running",
            cpu_cores=2,
            memory_mb=4096,
            criticality="medium",
            owner="ops",
            disks=[DiskCreate(disk_name="os", size_gb=60, storage_name="san-a")],
            networks=[NetworkCreate(ip_address="192.0.2.10", role="public")],
        ),
        editor,
    )

    cloned = clone_vm(db_session, source, editor)

    assert cloned.id != source.id
    assert cloned.name == "clone-source-copy"
    assert cloned.external_id is None
    assert cloned.health_score == source.health_score
    assert [(disk.disk_name, disk.size_gb, disk.storage_name) for disk in cloned.disks] == [
        ("os", 60, "san-a")
    ]
    assert [(network.ip_address, network.role.value) for network in cloned.networks] == [
        ("192.0.2.10", "public")
    ]


def test_list_vms_preserves_search_relations_filters_and_semantic_sort(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="query-service@example.com", role=UserRole.editor)
    critical = create_vm_row(
        db_session,
        editor,
        name="critical-vm",
        platform=Platform.proxmox,
        criticality=Criticality.critical,
        owner="alice",
    )
    high = create_vm_row(
        db_session,
        editor,
        name="high-vm",
        platform=Platform.vmware,
        criticality=Criticality.high,
        owner="bob",
    )
    medium = create_vm_row(
        db_session,
        editor,
        name="medium-vm",
        platform=Platform.proxmox,
        criticality=Criticality.medium,
        owner="carol",
    )
    low = create_vm_row(
        db_session,
        editor,
        name="low-vm",
        platform=Platform.vmware,
        criticality=Criticality.low,
        owner="dave",
    )
    db_session.add(VmApplication(vm_id=high.id, app_name="nginx", app_owner="web"))
    db_session.add(VmNetwork(vm_id=high.id, ip_address="198.51.100.20", role=NetworkRole.public))
    db_session.commit()

    searched, searched_total = list_vms(
        db_session,
        {"q": "nginx", "ip_role": [NetworkRole.public]},
        limit=20,
        offset=0,
    )
    assert searched_total == 1
    assert [vm.id for vm in searched] == [high.id]

    non_proxmox, non_proxmox_total = list_vms(
        db_session,
        {"platform": [Platform.proxmox], "platform_op": FilterOperator.neq},
        limit=20,
        offset=0,
        sort="criticality",
        direction="asc",
    )
    assert non_proxmox_total == 2
    assert [vm.id for vm in non_proxmox] == [high.id, low.id]

    ordered, total = list_vms(
        db_session, {}, limit=20, offset=0, sort="criticality", direction="asc"
    )
    assert total == 4
    assert [vm.id for vm in ordered] == [critical.id, high.id, medium.id, low.id]


@pytest.mark.parametrize(
    ("values", "operator", "expected"),
    [
        (["undefined"], FilterOperator.eq, {"null-os-vm"}),
        (["undefined"], FilterOperator.neq, {"linux-vm", "windows-vm"}),
        (["linux"], FilterOperator.eq, {"linux-vm"}),
        (["linux"], FilterOperator.neq, {"null-os-vm", "windows-vm"}),
        (["linux", "undefined"], FilterOperator.eq, {"linux-vm", "null-os-vm"}),
        (["linux", "undefined"], FilterOperator.neq, {"windows-vm"}),
        (["undefined"], FilterOperator.contains, {"null-os-vm"}),
    ],
)
def test_list_vms_undefined_os_family_filter(db_session: Session, values, operator, expected) -> None:
    editor = create_user(db_session, email="os-family-filter@example.com", role=UserRole.editor)
    for family, name in [("linux", "linux-vm"), ("windows", "windows-vm"), (None, "null-os-vm")]:
        create_vm_row(db_session, editor, name=name, os_family=family)

    result, total = list_vms(
        db_session, {"os_family": values, "os_family_op": operator}, limit=20, offset=0
    )
    assert total == len(expected)
    assert {vm.name for vm in result} == expected


def _bulk_apps(db_session: Session, vm, editor, **patch):
    from app.schemas.vms import VmBulkRequest, VmBulkUpdate
    from app.services.vms_bulk import bulk_update_vms

    result = bulk_update_vms(
        db_session,
        payload=VmBulkRequest(ids=[vm.id], patch=VmBulkUpdate(**patch)),
        user=editor,
    )
    assert result == {"updated": 1, "failed": []}
    return {
        (app.app_name, app.app_owner, app.description)
        for app in db_session.scalars(
            select(VmApplication).where(VmApplication.vm_id == vm.id)
        )
    }


def test_bulk_applications_add_skips_existing(db_session: Session) -> None:
    editor = create_user(db_session, email="bulk-app-add@example.com", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="bulk-app-add")
    db_session.add(VmApplication(vm_id=vm.id, app_name="Nginx", app_owner="web-team"))
    db_session.commit()

    apps = _bulk_apps(db_session, vm, editor, applications_add=[" nginx ", "Redis", "redis", " "])

    assert apps == {("Nginx", "web-team", None), ("Redis", None, None)}


def test_bulk_applications_remove_is_case_insensitive_and_preserves_others(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="bulk-app-rm@example.com", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="bulk-app-rm")
    db_session.add_all(
        [
            VmApplication(vm_id=vm.id, app_name="Nginx", app_owner="web-team"),
            VmApplication(vm_id=vm.id, app_name="Postgres", app_owner="dba", description="db"),
        ]
    )
    db_session.commit()

    apps = _bulk_apps(db_session, vm, editor, applications_remove=["NGINX", "missing"])

    assert apps == {("Postgres", "dba", "db")}


def test_bulk_applications_add_first_raises_health(db_session: Session) -> None:
    editor = create_user(db_session, email="bulk-app-first@example.com", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="bulk-app-first")
    base = update_vm(db_session, vm, VmUpdate(), editor).health_score

    _bulk_apps(db_session, vm, editor, applications_add=["Nginx"])
    db_session.refresh(vm)
    assert vm.health_score == base + 20


def test_bulk_applications_remove_last_drops_health_points(db_session: Session) -> None:
    editor = create_user(db_session, email="bulk-app-last@example.com", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="bulk-app-last")
    db_session.add(VmApplication(vm_id=vm.id, app_name="Nginx"))
    db_session.commit()
    with_app = update_vm(db_session, vm, VmUpdate(), editor).health_score

    assert _bulk_apps(db_session, vm, editor, applications_remove=["nginx"]) == set()
    db_session.refresh(vm)
    assert vm.health_score == with_app - 20


def test_bulk_applications_validation() -> None:
    from pydantic import ValidationError

    from app.schemas.vms import VmBulkUpdate

    assert VmBulkUpdate(applications_add=["  a  ", "", "  "]).applications_add == ["a"]
    with pytest.raises(ValidationError):
        VmBulkUpdate(applications_remove=["x" * 256])
