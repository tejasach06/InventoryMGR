from sqlalchemy.orm import Session

from app.db.models import UserRole

from .conftest import auth_headers, create_user, login


def test_get_accent_defaults_to_orange(client, db_session: Session) -> None:
    create_user(db_session, email="accent-default@example.com")
    login(client, "accent-default@example.com")

    response = client.get("/api/user/accent")

    assert response.status_code == 200, response.text
    assert response.json() == {"accent": "orange"}


def test_get_accent_defaults_when_saved_value_is_unknown(client, db_session: Session) -> None:
    user = create_user(db_session, email="accent-garbage@example.com")
    user.preferences = {"accent_color": "chartreuse"}
    db_session.commit()
    login(client, "accent-garbage@example.com")

    response = client.get("/api/user/accent")

    assert response.status_code == 200, response.text
    assert response.json() == {"accent": "orange"}


def test_put_accent_persists_for_viewer(client, db_session: Session) -> None:
    create_user(db_session, email="accent-violet@example.com", role=UserRole.viewer)
    csrf = login(client, "accent-violet@example.com")

    response = client.put("/api/user/accent", json={"accent": "violet"}, headers=auth_headers(csrf))

    assert response.status_code == 200, response.text
    assert response.json() == {"accent": "violet"}
    response = client.get("/api/user/accent")
    assert response.status_code == 200, response.text
    assert response.json() == {"accent": "violet"}


def test_put_accent_rejects_unknown_value(client, db_session: Session) -> None:
    create_user(db_session, email="accent-invalid@example.com")
    csrf = login(client, "accent-invalid@example.com")

    response = client.put(
        "/api/user/accent", json={"accent": "chartreuse"}, headers=auth_headers(csrf)
    )

    assert response.status_code == 422


def test_put_accent_requires_csrf(client, db_session: Session) -> None:
    create_user(db_session, email="accent-csrf@example.com")
    login(client, "accent-csrf@example.com")

    response = client.put("/api/user/accent", json={"accent": "blue"})

    assert response.status_code == 403


def test_put_accent_preserves_column_layout(client, db_session: Session) -> None:
    user = create_user(db_session, email="accent-layout@example.com")
    user.preferences = {"columns_inventory": [{"key": "name", "visible": True, "order": 0}]}
    db_session.commit()
    csrf = login(client, "accent-layout@example.com")

    response = client.put(
        "/api/user/accent", json={"accent": "emerald"}, headers=auth_headers(csrf)
    )

    assert response.status_code == 200, response.text
    db_session.refresh(user)
    assert user.preferences == {
        "columns_inventory": [{"key": "name", "visible": True, "order": 0}],
        "accent_color": "emerald",
    }
