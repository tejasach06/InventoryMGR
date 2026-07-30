from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import UserRole
from tests.conftest import create_user


def test_login_remember_me_true(client: TestClient, db_session: Session) -> None:
    create_user(db_session, email="remember_true@example.com", password="password123", role=UserRole.editor)
    response = client.post(
        "/api/auth/login",
        json={"email": "remember_true@example.com", "password": "password123", "remember": True},
    )
    assert response.status_code == 200
    cookies = response.headers.get_list("set-cookie")
    refresh_headers = [c for c in cookies if "inventorymgr_refresh=" in c]
    assert len(refresh_headers) == 1
    assert "Max-Age=604800" in refresh_headers[0]


def test_login_remember_me_false(client: TestClient, db_session: Session) -> None:
    create_user(db_session, email="remember_false@example.com", password="password123", role=UserRole.editor)
    response = client.post(
        "/api/auth/login",
        json={"email": "remember_false@example.com", "password": "password123", "remember": False},
    )
    assert response.status_code == 200
    cookies = response.headers.get_list("set-cookie")
    refresh_headers = [c for c in cookies if "inventorymgr_refresh=" in c]
    assert len(refresh_headers) == 1
    assert "Max-Age=" not in refresh_headers[0]
