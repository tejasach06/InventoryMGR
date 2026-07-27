from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import create_user, create_vm_row, login


def _seed(db: Session, user) -> None:
    # Same updated_at ordering for all three, so only the sort key can decide.
    create_vm_row(db, user, name="alpha", criticality="low", cpu_cores=8)
    create_vm_row(db, user, name="bravo", criticality="critical", cpu_cores=2)
    create_vm_row(db, user, name="charlie", criticality="medium", cpu_cores=4)


def test_sort_by_name_ascending(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    _seed(db_session, user)
    login(client, user.email)

    response = client.get("/api/vms", params={"sort": "name", "dir": "asc"})

    assert response.status_code == 200
    assert [item["name"] for item in response.json()["items"]] == ["alpha", "bravo", "charlie"]


def test_sort_by_criticality_uses_severity_not_alphabet(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    _seed(db_session, user)
    login(client, user.email)

    response = client.get("/api/vms", params={"sort": "criticality", "dir": "asc"})

    # Alphabetically this would be critical, low, medium — severity order is the
    # only order a user would call correct.
    assert [item["criticality"] for item in response.json()["items"]] == [
        "critical",
        "medium",
        "low",
    ]


def test_pages_do_not_overlap_or_skip_under_sort(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    # Every row shares one criticality, so only the name tie-break gives a total order.
    for index in range(10):
        create_vm_row(db_session, user, name=f"vm-{index:02d}", criticality="medium")
    login(client, user.email)

    first = client.get("/api/vms", params={"sort": "criticality", "limit": 5, "offset": 0}).json()
    second = client.get("/api/vms", params={"sort": "criticality", "limit": 5, "offset": 5}).json()

    names = [item["name"] for item in first["items"]] + [item["name"] for item in second["items"]]
    assert len(names) == 10
    assert len(set(names)) == 10
    assert first["total"] == 10


def test_unknown_sort_key_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    login(client, user.email)

    assert client.get("/api/vms", params={"sort": "password_hash"}).status_code == 422
    assert client.get("/api/vms", params={"sort": "name", "dir": "sideways"}).status_code == 422
