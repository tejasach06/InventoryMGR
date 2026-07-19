from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportAction, ImportStatus, UserRole, Vm, VmDisk, VmNetwork

from .conftest import auth_headers, create_user, create_vm_row, login


def upload_csv(client, csrf: str, content: str):
    return client.post(
        "/api/imports/preview",
        files={"file": ("inventory.csv", content.encode("utf-8"), "text/csv")},
        headers=auth_headers(csrf),
    )


def test_csv_preview_persists_classification_for_create_update_conflict_and_invalid(
    client, db_session: Session
) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="Existing App", external_id=None)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,status,cpu_cores,memory_mb,external_id,tags,ha_enabled,last_verified_at",
            "Existing App,Proxmox,pve-cluster-a,running,4,8192,,web; critical,yes,2026-06-13",
            " existing app ,pve,pve-cluster-a,powered_off,2,4096,,,false,",
            "New VMware,vcenter,vc-cluster,unknown,8,16384,vm-200,db;prod,no,2026-01-01",
            "Broken Row,vmware,vc-cluster,unknown,-1,1024,,,false,",
        ]
    )

    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"] == {"create": 1, "update": 1, "unchanged": 0, "conflict": 1, "invalid": 1}
    rows = sorted(body["rows"], key=lambda row: row["row_number"])
    assert [row["action"] for row in rows] == [
        ImportAction.update.value,
        ImportAction.conflict.value,
        ImportAction.create.value,
        ImportAction.invalid.value,
    ]
    assert rows[0]["normalized"]["platform"] == "proxmox"
    assert rows[2]["normalized"]["platform"] == "vmware"
    assert rows[2]["normalized"]["ha_enabled"] is False
    assert rows[1]["errors"] == [{"field": "identity", "message": "duplicate CSV identity"}]
    assert {error["field"] for error in rows[3]["errors"]} >= {"cpu_cores"}

    persisted = client.get(f"/api/imports/{body['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["summary"] == body["summary"]


def test_csv_commit_refuses_invalid_or_conflicting_batches(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(db_session, editor, name="Existing App", external_id=None)
    csrf = login(client, "editor@example.local")
    csv_content = "\n".join(
        [
            "name,platform,cluster",
            "Existing App,proxmox,pve-cluster-a",
            "existing app,proxmox,pve-cluster-a",
        ]
    )
    preview = upload_csv(client, csrf, csv_content)
    assert preview.status_code == 201, preview.text

    commit = client.post(f"/api/imports/{preview.json()['id']}/commit", headers=auth_headers(csrf))

    assert commit.status_code == 409
    assert commit.json()["detail"] == "Import contains invalid or conflicting rows"
    assert db_session.scalar(select(Vm).where(Vm.name == "existing app")) is None


def test_csv_commit_uses_persisted_rows_and_rolls_back_when_later_upsert_fails(
    client, db_session: Session
) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    existing = create_vm_row(
        db_session, editor, name="Manual Proxmox", external_id=None
    )
    csrf = login(client, "editor@example.local")
    csv_content = "\n".join(
        [
            "name,platform,cluster,status,cpu_cores,memory_mb,criticality,lifecycle",
            "New VMware,vmware,vc-cluster,running,2,4096,medium,active",
            "Manual Proxmox,proxmox,pve-cluster-a,running,6,12288,critical,active",
        ]
    )
    preview = upload_csv(client, csrf, csv_content)
    assert preview.status_code == 201, preview.text
    batch_id = preview.json()["id"]
    assert preview.json()["summary"] == {"create": 1, "update": 1, "unchanged": 0, "conflict": 0, "invalid": 0}

    # Simulate a concurrent identity change after preview. Commit must use the persisted
    # normalized rows, detect that the update target no longer matches, and leave no partial create.
    existing.name = "Manual Proxmox Renamed"
    db_session.add(existing)
    db_session.commit()

    commit = client.post(
        f"/api/imports/{batch_id}/commit",
        headers={**auth_headers(csrf), "Content-Type": "application/json"},
        json={"rows": [{"name": "client payload must be ignored"}]},
    )

    assert commit.status_code == 409
    assert commit.json()["detail"] == "Import target VM changed"
    assert db_session.scalar(select(Vm).where(Vm.name == "New VMware")) is None
    assert existing.status.value == "running"
    batch = client.get(f"/api/imports/{batch_id}").json()
    assert batch["status"] == ImportStatus.previewed.value


def test_import_rbac_and_batch_visibility(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    create_user(db_session, email="owner-editor@example.local", role=UserRole.editor)
    create_user(db_session, email="other-editor@example.local", role=UserRole.editor)
    create_user(db_session, email="root@example.local", role=UserRole.admin)
    csv_content = "\n".join(
        [
            "name,platform,cluster",
            "Visible Batch VM,proxmox,pve-cluster-a",
        ]
    )

    viewer_csrf = login(client, "viewer@example.local")
    viewer_preview = upload_csv(client, viewer_csrf, csv_content)
    assert viewer_preview.status_code == 403
    client.post("/api/auth/logout", headers=auth_headers(viewer_csrf))

    owner_csrf = login(client, "owner-editor@example.local")
    preview = upload_csv(client, owner_csrf, csv_content)
    assert preview.status_code == 201, preview.text
    batch_id = preview.json()["id"]
    client.post("/api/auth/logout", headers=auth_headers(owner_csrf))

    other_csrf = login(client, "other-editor@example.local")
    other_get = client.get(f"/api/imports/{batch_id}")
    assert other_get.status_code == 403
    other_commit = client.post(f"/api/imports/{batch_id}/commit", headers=auth_headers(other_csrf))
    assert other_commit.status_code == 403
    client.post("/api/auth/logout", headers=auth_headers(other_csrf))

    admin_csrf = login(client, "root@example.local")
    admin_get = client.get(f"/api/imports/{batch_id}")
    assert admin_get.status_code == 200
    admin_commit = client.post(f"/api/imports/{batch_id}/commit", headers=auth_headers(admin_csrf))
    assert admin_commit.status_code == 200
    assert admin_commit.json() == {"created": 1, "updated": 0}


def test_csv_preview_normalizes_sr_id_os_family_and_backup_enabled(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    csv_content = "\n".join(
        [
            "name,platform,cluster,sr_id,os_family,backup_enabled",
            "Imported Linux Box,proxmox,pve-cluster-a,SR-123,linux,yes",
            "Bogus OS,vmware,vc-cluster,SR-999,bogus,no",
        ]
    )

    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"] == {"create": 1, "update": 0, "unchanged": 0, "conflict": 0, "invalid": 1}
    rows = sorted(body["rows"], key=lambda row: row["row_number"])

    created = rows[0]
    assert created["action"] == ImportAction.create.value
    assert created["normalized"]["sr_id"] == "SR-123"
    assert created["normalized"]["os_family"] == "linux"
    assert created["normalized"]["backup_enabled"] is True

    invalid = rows[1]
    assert invalid["action"] == ImportAction.invalid.value
    assert {error["field"] for error in invalid["errors"]} == {"os_family"}


def test_csv_commit_persists_sr_id_os_family_and_backup_enabled(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    csv_content = "\n".join(
        [
            "name,platform,cluster,sr_id,os_family,backup_enabled",
            "Imported Linux Box,proxmox,pve-cluster-a,SR-777,linux,yes",
        ]
    )
    preview = upload_csv(client, csrf, csv_content)
    assert preview.status_code == 201, preview.text
    assert preview.json()["summary"] == {"create": 1, "update": 0, "unchanged": 0, "conflict": 0, "invalid": 0}

    commit = client.post(
        f"/api/imports/{preview.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text
    assert commit.json() == {"created": 1, "updated": 0}

    vm = db_session.scalar(select(Vm).where(Vm.sr_id == "SR-777"))
    assert vm is not None
    assert vm.os_family.value == "linux"
    assert vm.backup_enabled is True


def test_csv_commit_wraps_unexpected_row_error_as_actionable_4xx(
    client, db_session: Session, monkeypatch
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    csv_content = "\n".join(
        [
            "name,platform,cluster",
            "Kaboom VM,proxmox,pve-cluster-a",
        ]
    )
    preview = upload_csv(client, csrf, csv_content)
    assert preview.status_code == 201, preview.text
    batch_id = preview.json()["id"]

    def boom(*args, **kwargs):
        raise RuntimeError("simulated backend failure")

    monkeypatch.setattr("app.services.csv_import.create_vm", boom)

    commit = client.post(
        f"/api/imports/{batch_id}/commit", headers=auth_headers(csrf)
    )

    assert commit.status_code == 422, commit.text
    detail = commit.json()["detail"]
    assert "row" in detail.lower()
    assert "simulated backend failure" in detail
    # nothing partially committed
    assert db_session.scalar(select(Vm).where(Vm.name == "Kaboom VM")) is None

def test_partial_column_update_preserves_unmentioned_fields(
    client, db_session: Session
) -> None:
    """A CSV that names only some columns must not blank the rest."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        fqdn="existing-app.corp.example",
        owner="alice",
        description="payments api",
        cpu_cores=8,
        memory_mb=16384,
        monitoring_enabled=True,
    )
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner",
            "Existing App,proxmox,pve-cluster-a,bob",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["update"] == 1, body["summary"]

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    refreshed = db_session.get(Vm, vm_id)
    assert refreshed is not None
    assert refreshed.owner == "bob"
    assert refreshed.fqdn == "existing-app.corp.example"
    assert refreshed.description == "payments api"
    assert refreshed.cpu_cores == 8
    assert refreshed.memory_mb == 16384
    assert refreshed.monitoring_enabled is True


def test_blank_cell_in_present_column_does_not_overwrite(
    client, db_session: Session
) -> None:
    """Blank cell means "leave alone", exactly like an absent column."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        fqdn="existing-app.corp.example",
        owner="alice",
        cpu_cores=8,
        monitoring_enabled=True,
    )
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,fqdn,cpu_cores,monitoring_enabled",
            "Existing App,proxmox,pve-cluster-a,bob,,,",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    body = response.json()

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    refreshed = db_session.get(Vm, vm_id)
    assert refreshed is not None
    assert refreshed.owner == "bob"
    assert refreshed.fqdn == "existing-app.corp.example"
    assert refreshed.cpu_cores == 8
    assert refreshed.monitoring_enabled is True


def test_create_with_blank_cells_still_applies_defaults(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,status,criticality,cpu_cores,monitoring_enabled",
            "Brand New,proxmox,pve-cluster-a,,,,",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["create"] == 1

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Brand New"))
    assert created is not None
    assert created.status.value == "unknown"
    assert created.criticality.value == "medium"
    assert created.environment.value == "production"
    assert created.cpu_cores == 0
    assert created.monitoring_enabled is False


def test_every_header_is_handled_by_a_typed_group() -> None:
    """A new VmBase field must be classified, not silently ignored."""
    from app.services.csv_import import (
        ALL_HEADERS,
        BOOL_HEADERS,
        CHILD_HEADERS,
        DATE_HEADERS,
        ENUM_HEADERS,
        INT_HEADERS,
        LIST_HEADERS,
        REQUIRED_HEADERS,
        STRING_HEADERS,
    )

    handled = (
        set(STRING_HEADERS)
        | set(ENUM_HEADERS)
        | set(INT_HEADERS)
        | set(BOOL_HEADERS)
        | set(DATE_HEADERS)
        | set(LIST_HEADERS)
        | set(CHILD_HEADERS)
        | REQUIRED_HEADERS
    )
    assert handled == ALL_HEADERS


def test_backup_location_is_importable(client, db_session: Session) -> None:
    """Regression: backup_location shipped in migration 0010 but was never
    added to the CSV header list, so the downloadable template was rejected."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,backup_location",
            "Backed Up,proxmox,pve-cluster-a,veeam-repo-01",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Backed Up"))
    assert created is not None
    assert created.backup_location == "veeam-repo-01"


def test_unrecognized_columns_are_ignored_and_reported(
    client, db_session: Session
) -> None:
    """Hypervisor exports carry columns we do not model. Import what we
    recognize; name what we skipped so a typo'd header is visible."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,vmid,maxmem,uptime",
            "Exported VM,proxmox,pve-cluster-a,alice,101,8589934592,864000",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert sorted(body["ignored_columns"]) == ["maxmem", "uptime", "vmid"]
    assert body["summary"]["create"] == 1

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    created = db_session.scalar(select(Vm).where(Vm.name == "Exported VM"))
    assert created is not None
    assert created.owner == "alice"


def test_unchanged_rows_are_classified_separately(client, db_session: Session) -> None:
    """Re-importing an unmodified export must not read as N updates."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        cluster="pve-cluster-a",
        owner="alice",
        cpu_cores=8,
    )
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,cpu_cores",
            "Existing App,proxmox,pve-cluster-a,alice,8",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["unchanged"] == 1
    assert body["summary"]["update"] == 0
    assert body["rows"][0]["action"] == "unchanged"
    assert body["rows"][0]["changes"] == {}


def test_update_rows_record_changed_fields(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    create_vm_row(
        db_session,
        editor,
        name="Existing App",
        external_id=None,
        cluster="pve-cluster-a",
        owner="alice",
        cpu_cores=8,
    )
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,cpu_cores",
            "Existing App,proxmox,pve-cluster-a,bob,16",
        ]
    )
    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"]["update"] == 1
    assert body["rows"][0]["changes"] == {"owner": ["alice", "bob"], "cpu_cores": [8, 16]}
    assert body["field_changes"] == {"owner": 1, "cpu_cores": 1}


def test_disk_and_ip_attach_additively_on_update(client, db_session: Session) -> None:
    """Children were parsed and previewed on update, then discarded at commit."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=50, sort_order=0))
    db_session.add(VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disks,private_ip",
            "Existing App,proxmox,pve-cluster-a,data:500,10.0.0.6",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    networks = db_session.scalars(select(VmNetwork).where(VmNetwork.vm_id == vm_id)).all()

    # Added, and the pre-existing children survive.
    assert sorted(d.disk_name for d in disks) == ["data", "os"]
    assert sorted(n.ip_address for n in networks) == ["10.0.0.5", "10.0.0.6"]


def test_repeated_import_does_not_duplicate_children(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=50, sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    # Same disk name, different size and case — same disk, no second row.
    csv_content = "\n".join(
        [
            "name,platform,cluster,disks",
            "Existing App,proxmox,pve-cluster-a,OS:100",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    assert len(disks) == 1


def test_multi_disk_row_creates_every_disk(client, db_session: Session) -> None:
    """One row, several disks: the whole point of spec 3."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disks",
            "Multi Disk,proxmox,pve-cluster-a,os:100;data:500;logs:50",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    vm = db_session.scalar(select(Vm).where(Vm.name == "Multi Disk"))
    assert vm is not None
    disks = db_session.scalars(
        select(VmDisk).where(VmDisk.vm_id == vm.id).order_by(VmDisk.sort_order)
    ).all()
    assert [(d.disk_name, d.size_gb) for d in disks] == [
        ("os", 100),
        ("data", 500),
        ("logs", 50),
    ]


def test_multi_disk_update_adds_only_unmatched_and_never_resizes(
    client, db_session: Session
) -> None:
    """Additive means additive: a matched disk keeps its size even when the CSV disagrees."""
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=250, sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disks",
            "Existing App,proxmox,pve-cluster-a,os:100;data:500",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    sizes = {d.disk_name: d.size_gb for d in disks}
    assert sizes == {"os": 250, "data": 500}


def test_role_scoped_ip_columns_land_with_their_roles(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,private_ip,public_ip,backup_ip",
            "Roled VM,proxmox,pve-cluster-a,10.0.0.5;10.0.0.6,203.0.113.4,192.168.9.9",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    vm = db_session.scalar(select(Vm).where(Vm.name == "Roled VM"))
    assert vm is not None
    networks = db_session.scalars(select(VmNetwork).where(VmNetwork.vm_id == vm.id)).all()
    by_ip = {n.ip_address: n.role.value for n in networks}
    assert by_ip == {
        "10.0.0.5": "private",
        "10.0.0.6": "private",
        "203.0.113.4": "public",
        "192.168.9.9": "backup",
    }


def test_malformed_disks_cell_errors_the_row(client, db_session: Session) -> None:
    """A bad pair is a row error, not a silently dropped disk."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disks",
            "No Size,proxmox,pve-cluster-a,os:100;data",
            "Bad Size,proxmox,pve-cluster-a,os:abc",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    rows = response.json()["rows"]
    assert [r["action"] for r in rows] == [ImportAction.invalid, ImportAction.invalid]
    assert all(any(e["field"] == "disks" for e in r["errors"]) for r in rows)

    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 409, commit.text
    db_session.expire_all()
    assert db_session.scalar(select(Vm).where(Vm.name == "No Size")) is None


def test_blank_disks_cell_on_update_touches_no_children(client, db_session: Session) -> None:
    editor = create_user(db_session, email="editor@example.local", role=UserRole.editor)
    vm = create_vm_row(db_session, editor, name="Existing App", external_id=None)
    db_session.add(VmDisk(vm_id=vm.id, disk_name="os", size_gb=50, sort_order=0))
    db_session.commit()
    vm_id = vm.id
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,disks,owner",
            "Existing App,proxmox,pve-cluster-a,,bob",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text
    commit = client.post(
        f"/api/imports/{response.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    disks = db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id)).all()
    assert [(d.disk_name, d.size_gb) for d in disks] == [("os", 50)]


def test_retired_child_headers_are_ignored_and_reported(client, db_session: Session) -> None:
    """Old CSVs keep importing their VM fields; the dropped columns are named, not silent."""
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")

    csv_content = "\n".join(
        [
            "name,platform,cluster,owner,disk_name,disk_gb,ip_address",
            "Legacy CSV,proxmox,pve-cluster-a,bob,os,100,10.0.0.5",
        ]
    )
    response = upload_csv(client, csrf, csv_content)
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["ignored_columns"] == ["disk_gb", "disk_name", "ip_address"]

    commit = client.post(f"/api/imports/{body['id']}/commit", headers=auth_headers(csrf))
    assert commit.status_code == 200, commit.text

    db_session.expire_all()
    vm = db_session.scalar(select(Vm).where(Vm.name == "Legacy CSV"))
    assert vm is not None
    assert vm.owner == "bob"
    assert db_session.scalars(select(VmDisk).where(VmDisk.vm_id == vm.id)).all() == []


def test_template_endpoint_serves_importable_headers(client, db_session: Session) -> None:
    """The template must round-trip: every header it offers must be one the
    preview endpoint accepts."""
    from app.services.csv_import import ALL_HEADERS

    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    login(client, "viewer@example.local")

    response = client.get("/api/imports/template")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")

    headers = response.text.strip().split(",")
    assert set(headers) == ALL_HEADERS
    assert headers[:3] == ["name", "platform", "cluster"]
