from tests.conftest import auth_headers, create_user, login
from app.db.models import UserRole


def _mk(client, db, role=UserRole.editor):
    create_user(db, email="s@x.io", role=role)
    return login(client, "s@x.io")


def _create_cluster(client, csrf, **over):
    body = {"name": "pve-cluster-a"}
    body.update(over)
    return client.post("/api/clusters/", headers=auth_headers(csrf), json=body)


def test_create_and_detail(client, db_session):
    csrf = _mk(client, db_session)
    r = _create_cluster(client, csrf)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    d = client.get(f"/api/clusters/{cid}").json()
    assert d["name"] == "pve-cluster-a"
    assert d["nodes"] == []


def test_add_node_and_list_aggregates(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    n = client.post(
        f"/api/clusters/{cid}/nodes/",
        headers=auth_headers(csrf),
        json={
            "name": "node-01",
            "cpu_cores": 16,
            "cpu_threads": 32,
            "ram_total_gb": 128,
            "storage_usable_gb": 2000,
            "ip_addresses": [{"label": "mgmt", "address": "10.0.1.5"}],
            "datacenter": "dc-east-1",
            "rack": "Rack 12",
            "rack_unit": "U4",
        },
    )
    assert n.status_code == 201, n.text
    nid = n.json()["id"]
    assert n.json()["ip_addresses"] == [{"label": "mgmt", "address": "10.0.1.5"}]

    items = client.get("/api/clusters/").json()
    assert len(items) == 1
    assert items[0]["node_count"] == 1
    assert items[0]["total_ram_gb"] == 128
    assert items[0]["total_storage_gb"] == 2000

    d = client.get(f"/api/clusters/{cid}").json()
    assert len(d["nodes"]) == 1 and d["nodes"][0]["id"] == nid


def test_patch_node_partial_update(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    n = client.post(
        f"/api/clusters/{cid}/nodes/",
        headers=auth_headers(csrf),
        json={"name": "node-01", "ram_total_gb": 64},
    )
    nid = n.json()["id"]
    p = client.patch(
        f"/api/clusters/{cid}/nodes/{nid}",
        headers=auth_headers(csrf),
        json={"ram_used_gb": 32},
    )
    assert p.status_code == 200, p.text
    assert p.json()["ram_used_gb"] == 32 and p.json()["ram_total_gb"] == 64


def test_delete_cluster_cascades_nodes(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    client.post(
        f"/api/clusters/{cid}/nodes/", headers=auth_headers(csrf), json={"name": "node-01"}
    )
    r = client.delete(f"/api/clusters/{cid}", headers=auth_headers(csrf))
    assert r.status_code == 204
    assert client.get(f"/api/clusters/{cid}").status_code == 404
    assert client.get(f"/api/clusters/{cid}/nodes/").status_code == 404


def test_delete_node(client, db_session):
    csrf = _mk(client, db_session)
    cid = _create_cluster(client, csrf).json()["id"]
    nid = client.post(
        f"/api/clusters/{cid}/nodes/", headers=auth_headers(csrf), json={"name": "node-01"}
    ).json()["id"]
    r = client.delete(f"/api/clusters/{cid}/nodes/{nid}", headers=auth_headers(csrf))
    assert r.status_code == 204
    d = client.get(f"/api/clusters/{cid}").json()
    assert d["nodes"] == []