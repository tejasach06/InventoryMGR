import uuid

from sqlalchemy.orm import Session

from app.db.models import UserRole

from .conftest import auth_headers, create_user, login


def test_list_options_returns_all_categories_empty_initially(client, db_session: Session) -> None:
    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    login(client, "viewer@example.local")

    response = client.get("/api/settings/options")

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body.keys()) == {"cpu", "datacenter", "disk", "os", "os_by_family"}
    assert all(body[key] == [] for key in ("cpu", "datacenter", "disk", "os"))
    assert body["os_by_family"] == {"linux": [], "windows": []}


def test_admin_can_create_list_update_and_delete_options(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    created = client.post(
        "/api/settings/options",
        json={"category": "cpu", "value": "  8  "},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    option = created.json()
    assert option["category"] == "cpu"
    assert option["value"] == "8"
    option_id = option["id"]

    grouped = client.get("/api/settings/options").json()
    assert grouped["cpu"] == ["8"]

    all_options = client.get("/api/settings/options/all", headers=auth_headers(csrf)).json()
    assert any(item["id"] == option_id and item["value"] == "8" for item in all_options)

    updated = client.patch(
        f"/api/settings/options/{option_id}",
        json={"value": "16"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["value"] == "16"
    assert client.get("/api/settings/options").json()["cpu"] == ["16"]

    deleted = client.delete(f"/api/settings/options/{option_id}", headers=auth_headers(csrf))
    assert deleted.status_code == 204
    assert client.get("/api/settings/options").json()["cpu"] == []


def test_duplicate_option_returns_409(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    first = client.post(
        "/api/settings/options", json={"category": "cpu", "value": "4"}, headers=headers
    )
    assert first.status_code == 201, first.text

    duplicate = client.post(
        "/api/settings/options", json={"category": "cpu", "value": "4"}, headers=headers
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Dropdown option already exists for this category"


def test_settings_mutations_require_admin(client, db_session: Session) -> None:
    create_user(db_session, email="editor@example.local", role=UserRole.editor)
    csrf = login(client, "editor@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    create = client.post(
        "/api/settings/options", json={"category": "os", "value": "Linux"}, headers=headers
    )
    assert create.status_code == 403

    all_get = client.get("/api/settings/options/all", headers=auth_headers(csrf))
    assert all_get.status_code == 403

    # Editors can still read the grouped options so the VM form can load suggestions.
    assert client.get("/api/settings/options").status_code == 200


def test_update_missing_option_returns_404(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    missing = client.patch(
        f"/api/settings/options/{uuid.uuid4()}", json={"value": "X"}, headers=headers
    )
    assert missing.status_code == 404


def test_os_option_with_family_groups_under_os_by_family(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    created = client.post(
        "/api/settings/options",
        json={"category": "os", "value": "Ubuntu 22.04", "family": "linux"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["family"] == "linux"

    grouped = client.get("/api/settings/options").json()
    assert grouped["os"] == ["Ubuntu 22.04"]
    assert grouped["os_by_family"]["linux"] == ["Ubuntu 22.04"]
    assert grouped["os_by_family"]["windows"] == []


def test_non_os_option_ignores_family(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    created = client.post(
        "/api/settings/options",
        json={"category": "cpu", "value": "8", "family": "linux"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["family"] is None

    grouped = client.get("/api/settings/options").json()
    assert grouped["cpu"] == ["8"]
    assert grouped["os_by_family"] == {"linux": [], "windows": []}


def test_os_option_without_family_skipped_from_grouping(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    created = client.post(
        "/api/settings/options",
        json={"category": "os", "value": "Other"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["family"] is None

    grouped = client.get("/api/settings/options").json()
    assert grouped["os"] == ["Other"]
    assert grouped["os_by_family"]["linux"] == []
    assert grouped["os_by_family"]["windows"] == []


def test_update_os_option_family_persists(client, db_session: Session) -> None:
    create_user(db_session, email="admin@example.local", role=UserRole.admin)
    csrf = login(client, "admin@example.local")
    headers = {**auth_headers(csrf), "Content-Type": "application/json"}

    created = client.post(
        "/api/settings/options",
        json={"category": "os", "value": "Server 2022", "family": "linux"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    option_id = created.json()["id"]

    updated = client.patch(
        f"/api/settings/options/{option_id}",
        json={"value": "Server 2022", "family": "windows"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["family"] == "windows"

    grouped = client.get("/api/settings/options").json()
    assert grouped["os_by_family"]["windows"] == ["Server 2022"]
    assert grouped["os_by_family"]["linux"] == []
