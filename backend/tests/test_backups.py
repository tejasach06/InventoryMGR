import os
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import BackupJob, UserRole
from app.services import app_settings, backup_scheduler
from tests.conftest import auth_headers, create_user, login

pytestmark = pytest.mark.skipif(
    shutil.which("pg_dump") is None, reason="pg_dump not installed"
)


@pytest.fixture(autouse=True)
def configure_backup_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def test_backups_rbac_and_csrf(client: TestClient, db_session: Session):
    create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    viewer_csrf = login(client, "viewer@example.com")
    res = client.get("/api/backups", headers=auth_headers(viewer_csrf))
    assert res.status_code == 403

    res = client.post("/api/backups", headers=auth_headers(viewer_csrf))
    assert res.status_code == 403

    create_user(db_session, email="editor@example.com", role=UserRole.editor)
    editor_csrf = login(client, "editor@example.com")
    res = client.get("/api/backups", headers=auth_headers(editor_csrf))
    assert res.status_code == 403

    res = client.post("/api/backups", headers=auth_headers(editor_csrf))
    assert res.status_code == 403

    create_user(db_session, email="admin@example.com", role=UserRole.admin)
    login(client, "admin@example.com")
    # Admin without CSRF token header
    res = client.post("/api/backups")
    assert res.status_code == 403


def test_backups_crud_cycle(client: TestClient, db_session: Session, tmp_path: Path):
    create_user(db_session, email="admin-crud@example.com", role=UserRole.admin)
    csrf = login(client, "admin-crud@example.com")

    # Create manual backup
    res = client.post("/api/backups", headers=auth_headers(csrf))
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["status"] == "success"
    assert data["kind"] == "manual"
    filename = data["filename"]
    assert filename is not None

    dump_files = list(tmp_path.glob("*.dump"))
    assert len(dump_files) == 1
    assert dump_files[0].name == filename
    assert dump_files[0].stat().st_size > 0

    # Verify BackupJob in DB
    job = db_session.scalar(select(BackupJob).where(BackupJob.filename == filename))
    assert job is not None
    assert job.status == "success"
    assert job.size_bytes is not None and job.size_bytes > 0

    # List backups
    overview_res = client.get("/api/backups", headers=auth_headers(csrf))
    assert overview_res.status_code == 200
    overview_data = overview_res.json()
    assert any(b["name"] == filename for b in overview_data["backups"])
    assert any(j["filename"] == filename for j in overview_data["jobs"])

    # Download backup
    dl_res = client.get(
        f"/api/backups/{filename}/download", headers=auth_headers(csrf)
    )
    assert dl_res.status_code == 200
    assert dl_res.content.startswith(b"PGDMP")

    # Delete backup
    del_res = client.delete(
        f"/api/backups/{filename}", headers=auth_headers(csrf)
    )
    assert del_res.status_code == 204
    assert not (tmp_path / filename).exists()


def test_backups_path_traversal_rejection(client: TestClient, db_session: Session):
    create_user(db_session, email="admin-traversal@example.com", role=UserRole.admin)
    csrf = login(client, "admin-traversal@example.com")

    res = client.get(
        "/api/backups/..%2F..%2Fetc%2Fpasswd/download", headers=auth_headers(csrf)
    )
    assert res.status_code in (400, 404)


def test_backups_retention_prune(
    client: TestClient, db_session: Session, tmp_path: Path
):
    create_user(db_session, email="admin-prune@example.com", role=UserRole.admin)
    csrf = login(client, "admin-prune@example.com")

    # Set retention to 2
    patch_res = client.patch(
        "/api/backups/settings",
        json={"retention": 2},
        headers=auth_headers(csrf),
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["retention"] == 2

    # Create 3 backups
    for i in range(3):
        if i > 0:
            time.sleep(1.05)
        res = client.post("/api/backups", headers=auth_headers(csrf))
        assert res.status_code == 201
    dump_files = list(tmp_path.glob("*.dump"))
    assert len(dump_files) == 2


def test_backups_restore_validation(client: TestClient, db_session: Session):
    create_user(db_session, email="admin-restore@example.com", role=UserRole.admin)
    csrf = login(client, "admin-restore@example.com")

    # Incorrect confirmation
    res = client.post(
        "/api/backups/restore",
        data={"confirm": "wrong"},
        files={"file": ("test.dump", b"PGDMPsomecontent", "application/octet-stream")},
        headers=auth_headers(csrf),
    )
    assert res.status_code == 400
    assert "RESTORE" in res.json()["detail"]

    # Non pg_dump archive header
    res = client.post(
        "/api/backups/restore",
        data={"confirm": "RESTORE"},
        files={"file": ("test.dump", b"invalid not a dump", "application/octet-stream")},
        headers=auth_headers(csrf),
    )
    assert res.status_code == 400
    assert "Not a pg_dump" in res.json()["detail"]


def test_session_epoch_invalidation(client: TestClient, db_session: Session):
    create_user(db_session, email="admin-epoch@example.com", role=UserRole.admin)
    csrf = login(client, "admin-epoch@example.com")

    # Before epoch bump: request succeeds
    res = client.get("/api/auth/me", headers=auth_headers(csrf))
    assert res.status_code == 200

    # Bump session epoch
    time.sleep(1.05)
    app_settings.bump_session_epoch(db_session)
    # Reusing existing session token fails
    res_after = client.get("/api/auth/me", headers=auth_headers(csrf))
    assert res_after.status_code == 401
    assert "Session invalidated" in res_after.json()["detail"]

    # Refresh endpoint also rejects old refresh token
    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 401
    assert "Session invalidated" in refresh_res.json()["detail"]


def test_scheduler_tick(db_session: Session, tmp_path: Path):
    # Default is disabled -> _tick does nothing
    assert not app_settings.get_backup_enabled(db_session)
    backup_scheduler._tick()
    assert len(list(tmp_path.glob("*.dump"))) == 0

    # Enable scheduler -> first run creates a dump
    app_settings.set_backup_enabled(db_session, True)
    backup_scheduler._tick()

    dumps = list(tmp_path.glob("*.dump"))
    assert len(dumps) == 1

    job = db_session.scalar(
        select(BackupJob).where(BackupJob.kind == "scheduled").order_by(BackupJob.started_at.desc())
    )
    assert job is not None
    assert job.status == "success"

    # Immediate second tick -> no duplicate dump (within 23h)
    backup_scheduler._tick()
    assert len(list(tmp_path.glob("*.dump"))) == 1


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses filesystem write permissions")
def test_backup_unwritable_dir_returns_actionable_error(
    client: TestClient, db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0o500)
    monkeypatch.setenv("BACKUP_DIR", str(locked))
    get_settings.cache_clear()
    create_user(db_session, email="admin@example.com", role=UserRole.admin)
    csrf = login(client, "admin@example.com")
    resp = client.post("/api/backups", headers=auth_headers(csrf))
    assert resp.status_code == 500
    assert "not writable" in resp.json()["detail"]
    assert db_session.scalars(select(BackupJob)).all() == []  # no phantom job row
    locked.chmod(0o700)
