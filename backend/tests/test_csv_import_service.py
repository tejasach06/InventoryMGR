from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import AuditLog, ImportAction, UserRole, Vm, VmStatus
from app.services.csv_import import (
    commit_batch,
    create_preview_batch,
    identity_key,
    normalize_csv_row,
    parse_csv_bytes,
)

from .conftest import create_user, create_vm_row


def test_parse_and_normalize_preserve_current_csv_contract() -> None:
    rows, ignored = parse_csv_bytes(
        b"name,platform,cluster,cpu_cores,monitoring_enabled,tags,disks,private_ip,applications,ignored\n"
        b" app-01 ,PVE,pve-a,4,yes,prod; web,os:80:ssd:thin,10.0.0.5,nginx:web-team,value\n"
    )

    normalized, errors = normalize_csv_row(rows[0])

    assert ignored == ["ignored"]
    assert errors == []
    assert normalized == {
        "name": "app-01",
        "platform": "proxmox",
        "cluster": "pve-a",
        "cpu_cores": 4,
        "monitoring_enabled": True,
        "tags": ["prod", "web"],
    }


def test_normalize_rejects_invalid_values_with_exact_errors() -> None:
    normalized, errors = normalize_csv_row(
        {
            "name": "",
            "platform": "hyperv",
            "cluster": "",
            "cpu_cores": "-1",
            "monitoring_enabled": "sometimes",
            "disks": "os:not-a-size",
            "private_ip": "10.0.0.5:42",
            "applications": ":owner",
            "last_verified_at": "12/08/2026",
        }
    )

    assert normalized is None
    assert sorted(errors, key=lambda error: error["field"]) == [
        {"field": "applications", "message": "must be name or name:owner entries separated by ;"},
        {"field": "cluster", "message": "is required and cannot be blank"},
        {"field": "cpu_cores", "message": "must be an integer >= 0"},
        {
            "field": "disks",
            "message": "must be name:size[:storage_name[:storage_type]] separated by ;",
        },
        {"field": "last_verified_at", "message": "must be ISO date YYYY-MM-DD"},
        {"field": "monitoring_enabled", "message": "must be one of true, false, yes, no, 1, 0"},
        {"field": "name", "message": "is required and cannot be blank"},
        {"field": "platform", "message": "must be one of proxmox, pve, vmware, vsphere, vcenter"},
        {"field": "private_ip", "message": "must be IP addresses separated by ;"},
    ]


def test_identity_key_uses_cluster_not_node_or_datacenter() -> None:
    assert identity_key(
        {
            "platform": "proxmox",
            "external_id": "101",
            "name": "Existing App",
            "cluster": "PVE-Cluster-A",
            "node": "pve-01",
            "datacenter": "dc-a",
        }
    ) == identity_key(
        {
            "platform": "proxmox",
            "external_id": "101",
            "name": "existing app",
            "cluster": "pve-cluster-a",
            "node": "pve-99",
            "datacenter": "dc-z",
        }
    )
    assert identity_key(
        {
            "platform": "proxmox",
            "external_id": "101",
            "name": "Existing App",
            "cluster": "pve-cluster-a",
        }
    ) != identity_key(
        {
            "platform": "proxmox",
            "external_id": "202",
            "name": "Existing App",
            "cluster": "pve-cluster-a",
        }
    )
    assert identity_key(
        {
            "platform": "vmware",
            "external_id": "vm-101",
            "name": "Existing App",
            "cluster": "VC-Cluster-A",
            "node": "esx-01",
            "datacenter": "dc-a",
        }
    ) == identity_key(
        {
            "platform": "vmware",
            "external_id": "vm-202",
            "name": "existing app",
            "cluster": "vc-cluster-a",
            "node": "esx-99",
            "datacenter": "dc-z",
        }
    )
    assert identity_key(
        {"platform": "vmware", "name": "Existing App", "cluster": "vc-cluster-a"}
    ) != identity_key({"platform": "vmware", "name": "Existing App", "cluster": "vc-cluster-b"})


def test_preview_and_commit_preserve_matching_additive_children_audit_and_health(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-service@example.com", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Existing App",
        platform="proxmox",
        external_id="101",
        datacenter="dc-a",
        node="pve-01",
        owner="old-owner",
        monitoring_enabled=False,
    )
    initial_health = vm.health_score
    content = (
        b"name,platform,cluster,external_id,datacenter,node,owner,monitoring_enabled,disks,private_ip,applications\n"
        b"Existing App,pve,pve-cluster-a,101,dc-a,pve-01,new-owner,true,os:80:ssd:thin,10.0.0.5,nginx:web-team\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary == {
        "create": 0,
        "update": 1,
        "unchanged": 0,
        "conflict": 0,
        "invalid": 0,
        "decommission": 0,
    }
    assert batch.field_changes == {
        "applications": 1,
        "disks": 1,
        "monitoring_enabled": 1,
        "owner": 1,
        "private_ip": 1,
    }
    assert batch.rows[0].action == ImportAction.update
    assert batch.rows[0].target_vm_id == vm.id
    assert batch.rows[0].changes == {
        "disks": [None, ["os:80"]],
        "applications": [None, ["nginx"]],
        "private_ip": [None, ["10.0.0.5"]],
        "owner": ["old-owner", "new-owner"],
        "monitoring_enabled": [False, True],
    }

    assert commit_batch(db_session, batch_id=batch.id, user=editor) == {
        "created": 0,
        "updated": 1,
        "decommissioned": 0,
    }
    reloaded = db_session.scalar(
        select(Vm)
        .options(
            selectinload(Vm.disks),
            selectinload(Vm.networks),
            selectinload(Vm.applications),
        )
        .where(Vm.id == vm.id)
    )
    assert reloaded is not None
    assert [(d.disk_name, d.size_gb, d.storage_name, d.storage_type) for d in reloaded.disks] == [
        ("os", 80, "ssd", "thin")
    ]
    assert [(n.ip_address, n.role.value) for n in reloaded.networks] == [("10.0.0.5", "private")]
    assert [(a.app_name, a.app_owner) for a in reloaded.applications] == [("nginx", "web-team")]
    assert reloaded.health_score > initial_health
    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.vm_id == vm.id).order_by(AuditLog.field_name)
    ).all()
    assert [(entry.field_name, entry.old_value, entry.new_value) for entry in audits] == [
        ("monitoring_enabled", "False", "True"),
        ("owner", "old-owner", "new-owner"),
    ]


def test_preview_matches_proxmox_by_vmid_name_cluster_ignoring_node_and_datacenter(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-proxmox-match@example.com", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Migrated App",
        platform="proxmox",
        external_id="101",
        cluster="pve-cluster-a",
        datacenter="dc-a",
        node="pve-01",
        owner="old-owner",
    )
    content = (
        b"name,platform,cluster,external_id,datacenter,node,owner\n"
        b"Migrated App,pve,pve-cluster-a,101,dc-z,pve-99,new-owner\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary["update"] == 1
    assert batch.summary["create"] == 0
    assert batch.rows[0].action == ImportAction.update
    assert batch.rows[0].target_vm_id == vm.id
    assert batch.rows[0].changes == {
        "datacenter": ["dc-a", "dc-z"],
        "node": ["pve-01", "pve-99"],
        "owner": ["old-owner", "new-owner"],
    }


def test_preview_does_not_match_proxmox_when_vmid_differs(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-proxmox-vmid@example.com", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Migrated App",
        platform="proxmox",
        external_id="101",
        cluster="pve-cluster-a",
    )
    content = (
        b"name,platform,cluster,external_id,datacenter,node\n"
        b"Migrated App,pve,pve-cluster-a,202,dc-a,pve-01\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary["create"] == 1
    assert batch.rows[0].action == ImportAction.create
    assert batch.rows[0].target_vm_id is None


def test_preview_matches_vmware_by_name_cluster_ignoring_vmid_node_and_datacenter(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-vmware-match@example.com", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Moved Guest",
        platform="vmware",
        external_id="vm-101",
        cluster="vc-cluster-a",
        datacenter="dc-a",
        node="esx-01",
        owner="old-owner",
    )
    content = (
        b"name,platform,cluster,external_id,datacenter,node,owner\n"
        b"Moved Guest,vmware,vc-cluster-a,vm-202,dc-z,esx-99,new-owner\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary["update"] == 1
    assert batch.summary["create"] == 0
    assert batch.rows[0].action == ImportAction.update
    assert batch.rows[0].target_vm_id == vm.id
    assert batch.rows[0].changes == {
        "datacenter": ["dc-a", "dc-z"],
        "external_id": ["vm-101", "vm-202"],
        "node": ["esx-01", "esx-99"],
        "owner": ["old-owner", "new-owner"],
    }


def test_preview_does_not_match_vmware_when_cluster_differs(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-vmware-cluster@example.com", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Moved Guest",
        platform="vmware",
        external_id="vm-101",
        cluster="vc-cluster-a",
    )
    content = (
        b"name,platform,cluster,external_id,datacenter,node\n"
        b"Moved Guest,vmware,vc-cluster-b,vm-101,dc-a,esx-01\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary["create"] == 1
    assert batch.rows[0].action == ImportAction.create
    assert batch.rows[0].target_vm_id is None


def test_preview_flags_intrafile_duplicates_with_platform_identity_rules(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-duplicate@example.com", role=UserRole.editor)
    content = (
        b"name,platform,cluster,external_id,datacenter,node\n"
        b"Duplicate App,pve,pve-cluster-a,101,dc-a,pve-01\n"
        b"duplicate app,pve,PVE-Cluster-A,101,dc-z,pve-99\n"
        b"Duplicate Guest,vmware,vc-cluster-a,vm-101,dc-a,esx-01\n"
        b"duplicate guest,vmware,VC-Cluster-A,vm-202,dc-z,esx-99\n"
    )

    batch = create_preview_batch(db_session, filename="inventory.csv", content=content, user=editor)

    assert batch.summary == {
        "create": 2,
        "update": 0,
        "unchanged": 0,
        "conflict": 2,
        "invalid": 0,
        "decommission": 0,
    }
    assert [row.action for row in batch.rows] == [
        ImportAction.create,
        ImportAction.conflict,
        ImportAction.create,
        ImportAction.conflict,
    ]
    assert batch.rows[1].errors == [{"field": "identity", "message": "duplicate CSV identity"}]
    assert batch.rows[3].errors == [{"field": "identity", "message": "duplicate CSV identity"}]


def test_full_import_decommissions_absent_vm_and_records_audit_and_health(
    db_session: Session,
) -> None:
    editor = create_user(db_session, email="csv-full-decom@example.com", role=UserRole.editor)
    vm_alpha = create_vm_row(
        db_session,
        editor,
        name="alpha",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
        decommission_date=None,
    )
    vm_beta = create_vm_row(
        db_session,
        editor,
        name="beta",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
        decommission_date=None,
    )

    content = b"name,platform,cluster\nalpha,proxmox,pve-cluster-a\n"

    batch = create_preview_batch(
        db_session,
        filename="full_inventory.csv",
        content=content,
        user=editor,
        full_inventory=True,
    )

    assert batch.summary["decommission"] == 1
    assert batch.summary["unchanged"] == 1
    assert len(batch.rows) == 2
    decom_row = next(r for r in batch.rows if r.action == ImportAction.decommission)
    assert decom_row.target_vm_id == vm_beta.id
    assert decom_row.raw["name"] == "beta"

    result = commit_batch(
        db_session,
        batch_id=batch.id,
        user=editor,
        confirm_decommission=True,
    )
    assert result == {"created": 0, "updated": 0, "decommissioned": 1}

    db_session.refresh(vm_beta)
    db_session.refresh(vm_alpha)

    assert vm_beta.status == VmStatus.decommissioned
    assert vm_beta.decommission_date == date.today()
    assert vm_alpha.status == VmStatus.running

    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.vm_id == vm_beta.id).order_by(AuditLog.field_name)
    ).all()
    status_audits = [
        (a.field_name, a.old_value, a.new_value) for a in audits if a.field_name == "status"
    ]
    assert status_audits == [("status", "running", "decommissioned")]


def test_full_import_preserves_existing_decommission_date(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-date-pres@example.com", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="alpha",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
    )
    existing_date = date(2025, 1, 1)
    vm_beta = create_vm_row(
        db_session,
        editor,
        name="beta",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
        decommission_date=existing_date,
    )

    content = b"name,platform,cluster\nalpha,proxmox,pve-cluster-a\n"
    batch = create_preview_batch(
        db_session,
        filename="full_inventory.csv",
        content=content,
        user=editor,
        full_inventory=True,
    )
    commit_batch(
        db_session,
        batch_id=batch.id,
        user=editor,
        confirm_decommission=True,
    )

    db_session.refresh(vm_beta)
    assert vm_beta.status == VmStatus.decommissioned
    assert vm_beta.decommission_date == existing_date


def test_partial_import_leaves_absent_vms_untouched(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-partial@example.com", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="alpha",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
    )
    vm_beta = create_vm_row(
        db_session,
        editor,
        name="beta",
        platform="proxmox",
        cluster="pve-cluster-a",
        status="running",
    )

    content = b"name,platform,cluster\nalpha,proxmox,pve-cluster-a\n"
    batch = create_preview_batch(
        db_session,
        filename="partial_inventory.csv",
        content=content,
        user=editor,
        full_inventory=False,
    )

    assert batch.summary.get("decommission", 0) == 0
    assert not any(r.action == ImportAction.decommission for r in batch.rows)

    result = commit_batch(db_session, batch_id=batch.id, user=editor)
    assert result == {"created": 0, "updated": 0, "decommissioned": 0}

    db_session.refresh(vm_beta)
    assert vm_beta.status == VmStatus.running


def test_full_import_guard_protects_against_major_decommission(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-guard@example.com", role=UserRole.editor)
    create_vm_row(
        db_session, editor, name="vm1", platform="proxmox", cluster="c1", status="running"
    )
    create_vm_row(
        db_session, editor, name="vm2", platform="proxmox", cluster="c1", status="running"
    )
    create_vm_row(
        db_session, editor, name="vm3", platform="proxmox", cluster="c1", status="running"
    )

    # 1 present, 2 absent (2 of 3 > 50%)
    content = b"name,platform,cluster\nvm1,proxmox,c1\n"
    batch = create_preview_batch(
        db_session,
        filename="full_inventory.csv",
        content=content,
        user=editor,
        full_inventory=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        commit_batch(db_session, batch_id=batch.id, user=editor, confirm_decommission=False)
    assert exc_info.value.status_code == 409
    assert "over half" in exc_info.value.detail

    result = commit_batch(db_session, batch_id=batch.id, user=editor, confirm_decommission=True)
    assert result == {"created": 0, "updated": 0, "decommissioned": 2}


def test_already_decommissioned_vms_are_not_candidates(db_session: Session) -> None:
    editor = create_user(db_session, email="csv-already-decom@example.com", role=UserRole.editor)
    create_vm_row(
        db_session, editor, name="vm1", platform="proxmox", cluster="c1", status="running"
    )
    create_vm_row(
        db_session, editor, name="vm2", platform="proxmox", cluster="c1", status="decommissioned"
    )

    content = b"name,platform,cluster\nvm1,proxmox,c1\n"
    batch = create_preview_batch(
        db_session,
        filename="full_inventory.csv",
        content=content,
        user=editor,
        full_inventory=True,
    )

    assert batch.summary["decommission"] == 0
    assert len([r for r in batch.rows if r.action == ImportAction.decommission]) == 0
