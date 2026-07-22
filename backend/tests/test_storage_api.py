from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login


def _mk(client, db, role=UserRole.editor):
    create_user(db, email="s@x.io", role=role)
    return login(client, "s@x.io")


def _create_array(client, csrf, **over):
    body = {
        "name": "syn-01",
        "vendor": "synology",
        "total_capacity_gb": 1000,
        "used_capacity_gb": 850,
    }
    body.update(over)
    return client.post("/api/storage/arrays", headers=auth_headers(csrf), json=body)


def test_create_and_detail(client, db_session):
    csrf = _mk(client, db_session)
    r = _create_array(client, csrf)
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    d = client.get(f"/api/storage/arrays/{aid}").json()
    assert d["used_pct"] == 85.0 and d["over_threshold"] is True


def test_list_counts_children(client, db_session):
    csrf = _mk(client, db_session)
    aid = _create_array(client, csrf).json()["id"]
    v = client.post(
        f"/api/storage/arrays/{aid}/volumes",
        headers=auth_headers(csrf),
        json={"name": "vol1", "capacity_gb": 500, "used_gb": 100},
    )
    assert v.status_code == 201, v.text
    vid = v.json()["id"]
    lun = client.post(
        f"/api/storage/volumes/{vid}/luns",
        headers=auth_headers(csrf),
        json={"name": "lun0", "size_gb": 100, "cluster": "pve-a"},
    )
    assert lun.status_code == 201, lun.text
    share = client.post(
        f"/api/storage/volumes/{vid}/shares",
        headers=auth_headers(csrf),
        json={"export_path": "/vol1/s"},
    )
    assert share.status_code == 201, share.text

    items = client.get("/api/storage/arrays").json()
    assert len(items) == 1
    assert items[0]["volume_count"] == 1
    assert items[0]["lun_count"] == 1
    assert items[0]["share_count"] == 1

    d = client.get(f"/api/storage/arrays/{aid}").json()
    vol = d["volumes"][0]
    assert vol["used_pct"] == 20.0 and vol["over_threshold"] is False
    assert len(vol["luns"]) == 1 and len(vol["shares"]) == 1


def test_delete_array_cascades(client, db_session):
    csrf = _mk(client, db_session)
    aid = _create_array(client, csrf).json()["id"]
    client.post(
        f"/api/storage/arrays/{aid}/volumes",
        headers=auth_headers(csrf),
        json={"name": "vol1"},
    )
    r = client.delete(f"/api/storage/arrays/{aid}", headers=auth_headers(csrf))
    assert r.status_code == 204
    assert client.get(f"/api/storage/arrays/{aid}").status_code == 404
    assert client.get(f"/api/storage/arrays/{aid}/volumes").status_code == 404


def test_patch_array_recomputes_threshold(client, db_session):
    csrf = _mk(client, db_session)
    aid = _create_array(client, csrf, used_capacity_gb=100).json()["id"]
    d = client.get(f"/api/storage/arrays/{aid}").json()
    assert d["over_threshold"] is False
    p = client.patch(
        f"/api/storage/arrays/{aid}",
        headers=auth_headers(csrf),
        json={"used_capacity_gb": 950},
    )
    assert p.status_code == 200
    assert p.json()["used_pct"] == 95.0 and p.json()["over_threshold"] is True
