from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import UserRole

from .conftest import auth_headers, create_user, login


def _login_as(client: TestClient, db_session: Session, *, role: UserRole, email: str) -> str:
    create_user(db_session, email=email, role=role)
    return login(client, email)


def test_rbac_storage_requires_editor_and_csrf_for_array_mutation(
    client: TestClient, db_session: Session
) -> None:
    viewer_csrf = _login_as(
        client, db_session, role=UserRole.viewer, email="storage-viewer@example.com"
    )
    payload = {
        "name": "SAN-01",
        "vendor": "synology",
        "total_capacity_gb": 1000,
        "used_capacity_gb": 100,
    }

    forbidden = client.post("/api/storage/arrays", json=payload, headers=auth_headers(viewer_csrf))
    assert forbidden.status_code == 403

    client.cookies.clear()
    _login_as(client, db_session, role=UserRole.editor, email="storage-editor@example.com")
    missing_csrf = client.post("/api/storage/arrays", json=payload)
    assert missing_csrf.status_code == 403


def test_storage_editor_can_create_array_and_volume(client: TestClient, db_session: Session) -> None:
    csrf = _login_as(client, db_session, role=UserRole.editor, email="storage-ok@example.com")

    array_response = client.post(
        "/api/storage/arrays",
        json={
            "name": "SAN-02",
            "vendor": "netapp",
            "total_capacity_gb": 2000,
            "used_capacity_gb": 500,
        },
        headers=auth_headers(csrf),
    )
    assert array_response.status_code == 201, array_response.text
    array_id = array_response.json()["id"]

    volume_response = client.post(
        f"/api/storage/arrays/{array_id}/volumes",
        json={"name": "vol-01", "capacity_gb": 1000, "used_gb": 100},
        headers=auth_headers(csrf),
    )
    assert volume_response.status_code == 201, volume_response.text
    assert volume_response.json()["array_id"] == array_id


def test_cluster_rbac_and_node_relationships(client: TestClient, db_session: Session) -> None:
    viewer_csrf = _login_as(
        client, db_session, role=UserRole.viewer, email="cluster-viewer@example.com"
    )
    forbidden = client.post(
        "/api/clusters", json={"name": "compute-a"}, headers=auth_headers(viewer_csrf)
    )
    assert forbidden.status_code == 403

    client.cookies.clear()
    csrf = _login_as(client, db_session, role=UserRole.editor, email="cluster-editor@example.com")
    cluster_response = client.post(
        "/api/clusters", json={"name": "compute-a"}, headers=auth_headers(csrf)
    )
    assert cluster_response.status_code == 201, cluster_response.text
    cluster_id = cluster_response.json()["id"]

    node_response = client.post(
        f"/api/clusters/{cluster_id}/nodes",
        json={
            "name": "node-01",
            "cpu_cores": 32,
            "cpu_threads": 64,
            "ram_total_gb": 256,
            "storage_usable_gb": 4000,
            "ip_addresses": [{"label": "mgmt", "address": "10.0.10.11"}],
        },
        headers=auth_headers(csrf),
    )
    assert node_response.status_code == 201, node_response.text
    assert node_response.json()["cluster_id"] == cluster_id
    assert node_response.json()["ip_addresses"] == [{"label": "mgmt", "address": "10.0.10.11"}]
