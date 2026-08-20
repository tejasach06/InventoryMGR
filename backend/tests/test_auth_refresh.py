from sqlalchemy.orm import Session

from app.db.models import UserRole

from .conftest import create_user


def test_refresh_preserves_remember_me_persistence(client, db_session: Session) -> None:
    create_user(db_session, email="editor-persist@example.com", role=UserRole.editor)
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "editor-persist@example.com",
            "password": "correct horse battery staple",
            "remember": True,
        },
    )
    assert login_res.status_code == 200, login_res.text

    login_set_cookies = login_res.headers.get_list("set-cookie")
    login_refresh_cookie = next(
        (c for c in login_set_cookies if c.startswith("inventorymgr_refresh=")), None
    )
    assert login_refresh_cookie is not None
    assert "Max-Age=" in login_refresh_cookie or "max-age=" in login_refresh_cookie.lower()

    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 200, refresh_res.text

    refresh_set_cookies = refresh_res.headers.get_list("set-cookie")
    refresh_cookie = next(
        (c for c in refresh_set_cookies if c.startswith("inventorymgr_refresh=")), None
    )
    assert refresh_cookie is not None
    assert "Max-Age=" in refresh_cookie or "max-age=" in refresh_cookie.lower()


def test_refresh_without_remember_stays_session_scoped(client, db_session: Session) -> None:
    create_user(db_session, email="editor-session@example.com", role=UserRole.editor)
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "editor-session@example.com",
            "password": "correct horse battery staple",
            "remember": False,
        },
    )
    assert login_res.status_code == 200, login_res.text

    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 200, refresh_res.text

    refresh_set_cookies = refresh_res.headers.get_list("set-cookie")
    refresh_cookie = next(
        (c for c in refresh_set_cookies if c.startswith("inventorymgr_refresh=")), None
    )
    assert refresh_cookie is not None
    assert "max-age" not in refresh_cookie.lower()


def test_refresh_returns_200_and_rotates_session_for_editor(client, db_session: Session) -> None:
    create_user(db_session, email="editor-rotate@example.com", role=UserRole.editor)
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "editor-rotate@example.com",
            "password": "correct horse battery staple",
        },
    )
    assert login_res.status_code == 200, login_res.text
    old_session = client.cookies.get("inventorymgr_session")
    assert old_session is not None
    import time

    time.sleep(1.05)
    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 200, refresh_res.text
    data = refresh_res.json()
    assert data["user"]["email"] == "editor-rotate@example.com"
    new_session = client.cookies.get("inventorymgr_session")
    assert new_session is not None
    assert new_session != old_session


def test_refresh_rejects_a_session_token_used_as_a_refresh_token(
    client, db_session: Session
) -> None:
    create_user(db_session, email="editor-typecheck@example.com", role=UserRole.editor)
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "editor-typecheck@example.com",
            "password": "correct horse battery staple",
        },
    )
    assert login_res.status_code == 200, login_res.text
    session_token = client.cookies.get("inventorymgr_session")
    assert session_token is not None

    # Replace refresh cookie with session token
    client.cookies.set("inventorymgr_refresh", session_token)
    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 401, refresh_res.text


def test_refresh_without_cookie_returns_401(client) -> None:
    client.cookies.clear()
    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 401


def test_refresh_rejects_inactive_user(client, db_session: Session) -> None:
    user = create_user(db_session, email="editor-inactive@example.com", role=UserRole.editor)
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "editor-inactive@example.com",
            "password": "correct horse battery staple",
        },
    )
    assert login_res.status_code == 200, login_res.text

    user.is_active = False
    db_session.commit()

    refresh_res = client.post("/api/auth/refresh")
    assert refresh_res.status_code == 401
