from types import SimpleNamespace

from app.core.crypto import decrypt_secret
from app.db.models import LdapConfig, User, UserRole
from tests.conftest import auth_headers, create_user, login


def _payload(**overrides):
    payload = {
        "enabled": False,
        "server_uri": "ldap://ldap.example.com",
        "user_base_dn": "dc=example,dc=com",
    }
    payload.update(overrides)
    return payload


def _admin_headers(client, db_session):
    admin = create_user(db_session, email="admin@example.com", role=UserRole.admin)
    return auth_headers(login(client, admin.email))


def test_only_admin_can_read_and_save_ldap_config(client, db_session):
    viewer = create_user(db_session, email="viewer@example.com", role=UserRole.viewer)
    viewer_csrf = login(client, viewer.email)
    assert client.get("/api/settings/ldap").status_code == 403
    assert (
        client.put("/api/settings/ldap", headers=auth_headers(viewer_csrf), json={}).status_code
        == 403
    )

    headers = _admin_headers(client, db_session)
    assert client.put("/api/settings/ldap", json=_payload()).status_code == 403
    response = client.put("/api/settings/ldap", headers=headers, json=_payload())
    assert response.status_code == 200, response.text


def test_ldap_secret_is_encrypted_and_can_be_cleared(client, db_session):
    headers = _admin_headers(client, db_session)
    response = client.put(
        "/api/settings/ldap", headers=headers, json=_payload(bind_password="s3cret")
    )
    assert response.status_code == 200
    assert response.json()["bind_password_set"] is True
    assert "bind_password" not in response.json()
    assert "bind_password_encrypted" not in response.json()
    config = db_session.get(LdapConfig, 1)
    assert config and config.bind_password_encrypted != "s3cret"
    assert decrypt_secret(config.bind_password_encrypted) == "s3cret"

    encrypted = config.bind_password_encrypted
    assert client.put("/api/settings/ldap", headers=headers, json=_payload()).status_code == 200
    assert db_session.get(LdapConfig, 1).bind_password_encrypted == encrypted
    assert (
        client.put(
            "/api/settings/ldap", headers=headers, json=_payload(bind_password="")
        ).status_code
        == 200
    )
    assert db_session.get(LdapConfig, 1).bind_password_encrypted is None


def test_disabled_ldap_rejects_directory_only_login(client, db_session):
    headers = _admin_headers(client, db_session)
    assert client.put("/api/settings/ldap", headers=headers, json=_payload()).status_code == 200
    assert (
        client.post(
            "/api/auth/login", json={"email": "directory@example.com", "password": "password"}
        ).status_code
        == 401
    )


def test_ldap_login_provisions_once_with_group_role(client, db_session, monkeypatch):
    class Entry:
        entry_dn = "uid=directory,dc=example,dc=com"

        def __getitem__(self, key):
            return SimpleNamespace(
                values={
                    "mail": ["directory@example.com"],
                    "memberOf": ["cn=admins,dc=example,dc=com"],
                }[key]
            )

    class Connection:
        def __init__(self, *_args, **_kwargs):
            self.entries = []

        def search(self, *_args, **_kwargs):
            self.entries = [Entry()]

        def start_tls(self):
            return True

    monkeypatch.setattr(
        "app.services.ldap_auth.Server", lambda *args, **kwargs: SimpleNamespace(ssl=False)
    )
    monkeypatch.setattr("app.services.ldap_auth.Connection", Connection)
    headers = _admin_headers(client, db_session)
    assert (
        client.put(
            "/api/settings/ldap",
            headers=headers,
            json=_payload(enabled=True, admin_group_dn="cn=admins,dc=example,dc=com"),
        ).status_code
        == 200
    )

    for _ in range(2):
        response = client.post(
            "/api/auth/login", json={"email": "directory@example.com", "password": "password"}
        )
        assert response.status_code == 200, response.text
    users = db_session.query(User).filter_by(email="directory@example.com").all()
    assert len(users) == 1
    assert users[0].role == UserRole.admin
    assert users[0].auth_source == "ldap"


def test_local_user_keeps_password_and_role_when_ldap_enabled(client, db_session, monkeypatch):
    local = create_user(
        db_session, email="local@example.com", password="local-password", role=UserRole.editor
    )
    monkeypatch.setattr(
        "app.services.ldap_auth.authenticate",
        lambda *_args: (_ for _ in ()).throw(AssertionError("LDAP must not run")),
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": local.email, "password": "local-password"}
        ).status_code
        == 200
    )
