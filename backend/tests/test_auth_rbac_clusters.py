from app.db.models import UserRole
from tests.conftest import auth_headers, create_user, login

CLUSTER_BODY = {"name": "pve-cluster-a"}


def test_viewer_cannot_create(client, db_session):
    create_user(db_session, email="v@x.io", role=UserRole.viewer)
    csrf = login(client, "v@x.io")
    r = client.post("/api/clusters/", headers=auth_headers(csrf), json=CLUSTER_BODY)
    assert r.status_code == 403


def test_editor_create_without_csrf_forbidden(client, db_session):
    create_user(db_session, email="e@x.io", role=UserRole.editor)
    login(client, "e@x.io")
    r = client.post("/api/clusters/", json=CLUSTER_BODY)
    assert r.status_code == 403


def test_unauthenticated_list_forbidden(client, db_session):
    r = client.get("/api/clusters/")
    assert r.status_code == 401