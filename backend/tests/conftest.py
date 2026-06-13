import os
from collections.abc import Generator
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-jwt-signing")
os.environ.setdefault(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://inventorymgr@127.0.0.1:54329/inventorymgr_test",
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from app.api import deps  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db import session as session_module  # noqa: E402
from app.db.models import Base, User, UserRole, Vm  # noqa: E402
from app.main import app  # noqa: E402

get_settings.cache_clear()
TEST_DATABASE_URL = os.environ["TEST_DATABASE_URL"]
engine = create_engine(
    TEST_DATABASE_URL, pool_pre_ping=True, connect_args={"prepare_threshold": None}
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def reset_database() -> Generator[None, None, None]:
    engine.dispose()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[session_module.get_db] = override_get_db
    app.dependency_overrides[deps.get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def create_user(
    db: Session,
    *,
    email: str,
    password: str = "correct horse battery staple",
    role: UserRole = UserRole.viewer,
    is_active: bool = True,
) -> User:
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def login(client: TestClient, email: str, password: str = "correct horse battery staple") -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    csrf = client.cookies.get("inventorymgr_csrf")
    assert csrf
    assert client.cookies.get("inventorymgr_session")
    return csrf


def auth_headers(csrf: str) -> dict[str, str]:
    return {"X-CSRF-Token": csrf}


def vm_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "pve-app-01",
        "platform": "proxmox",
        "environment": "lab",
        "datacenter": "dc-a",
        "cluster": "pve-cluster-a",
        "host": "pve01",
        "external_id": None,
        "status": "running",
        "cpu_cores": 4,
        "memory_mb": 8192,
        "disk_gb": 120,
        "os_name": "Debian 12",
        "ip_addresses": ["10.0.0.10"],
        "owner": "ops",
        "notes": "manual inventory",
        "backup_status": "protected",
        "ha_enabled": True,
        "dr_tier": "tier-2",
        "criticality": "high",
        "lifecycle": "active",
        "tags": ["web", "prod-like"],
        "last_verified_at": "2026-06-13",
    }
    payload.update(overrides)
    return payload


def create_vm_row(db: Session, user: User, **overrides: Any) -> Vm:
    values = vm_payload(**overrides)
    if isinstance(values.get("last_verified_at"), str):
        values["last_verified_at"] = date.fromisoformat(values["last_verified_at"])
    vm = Vm(
        **values,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(vm)
    db.commit()
    db.refresh(vm)
    return vm
