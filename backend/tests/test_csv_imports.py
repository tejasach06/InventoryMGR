from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportAction, ImportStatus, UserRole, Vm

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
            "name,platform,cluster,status,cpu_cores,memory_mb,disk_gb,external_id,ip_addresses,tags,ha_enabled,last_verified_at",
            "Existing App,Proxmox,pve-cluster-a,running,4,8192,120,,"
            "10.0.0.10;10.0.0.11,web; critical,yes,2026-06-13",
            " existing app ,pve,pve-cluster-a,stopped,2,4096,80,,,,false,",
            "New VMware,vcenter,vc-cluster,unknown,8,16384,200,"
            "vm-200,192.168.1.20,db;prod,no,2026-01-01",
            "Broken Row,vmware,vc-cluster,unknown,-1,1024,20,,,,false,",
        ]
    )

    response = upload_csv(client, csrf, csv_content)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["summary"] == {"create": 1, "update": 1, "conflict": 1, "invalid": 1}
    rows = sorted(body["rows"], key=lambda row: row["row_number"])
    assert [row["action"] for row in rows] == [
        ImportAction.update.value,
        ImportAction.conflict.value,
        ImportAction.create.value,
        ImportAction.invalid.value,
    ]
    assert rows[0]["normalized"]["platform"] == "proxmox"
    assert rows[0]["normalized"]["ip_addresses"] == ["10.0.0.10", "10.0.0.11"]
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
            "name,platform,cluster,status,cpu_cores,memory_mb,disk_gb,criticality,lifecycle",
            "New VMware,vmware,vc-cluster,running,2,4096,60,medium,active",
            "Manual Proxmox,proxmox,pve-cluster-a,stopped,6,12288,150,critical,active",
        ]
    )
    preview = upload_csv(client, csrf, csv_content)
    assert preview.status_code == 201, preview.text
    batch_id = preview.json()["id"]
    assert preview.json()["summary"] == {"create": 1, "update": 1, "conflict": 0, "invalid": 0}

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
    assert body["summary"] == {"create": 1, "update": 0, "conflict": 0, "invalid": 1}
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
    assert preview.json()["summary"] == {"create": 1, "update": 0, "conflict": 0, "invalid": 0}

    commit = client.post(
        f"/api/imports/{preview.json()['id']}/commit", headers=auth_headers(csrf)
    )
    assert commit.status_code == 200, commit.text
    assert commit.json() == {"created": 1, "updated": 0}

    vm = db_session.scalar(select(Vm).where(Vm.sr_id == "SR-777"))
    assert vm is not None
    assert vm.os_family.value == "linux"
    assert vm.backup_enabled is True