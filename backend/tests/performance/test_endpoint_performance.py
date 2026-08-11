from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import (
    Criticality,
    Environment,
    OsFamily,
    Platform,
    User,
    UserRole,
    Vm,
    VmStatus,
    VmType,
)
from app.db.session import SessionLocal, engine
from app.main import app

WARMUPS = 5
SAMPLES = 30
VM_COUNT = 200
ENDPOINTS = {
    "dashboard": "/api/dashboard",
    "reports_summary": "/api/reports/summary",
    "vm_list": "/api/vms?page=1&page_size=100&sort=name&direction=asc",
}


def _reset_public_schema(db_engine: Engine) -> None:
    db_engine.dispose()
    with db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
    db_engine.dispose()
    command.upgrade(Config("alembic.ini"), "head")
    db_engine.dispose()


def _create_admin_and_vms(db: Session) -> None:
    admin = User(
        email="perf-admin@example.com",
        password_hash=hash_password("correct horse battery staple"),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(admin)
    db.flush()
    rows = []
    statuses = [VmStatus.running, VmStatus.powered_off, VmStatus.unknown]
    environments = [Environment.production, Environment.development, Environment.testing, Environment.uat]
    criticalities = [Criticality.low, Criticality.medium, Criticality.high, Criticality.critical]
    for i in range(VM_COUNT):
        rows.append(
            Vm(
                name=f"perf-vm-{i:03d}",
                platform=Platform.proxmox,
                datacenter=f"dc-{i % 3}",
                cluster=f"cluster-{i % 5}",
                node=f"node-{i % 10}",
                status=statuses[i % len(statuses)],
                environment=environments[i % len(environments)],
                criticality=criticalities[i % len(criticalities)],
                vm_type=VmType.permanent,
                cpu_cores=1 + (i % 16),
                memory_mb=1024 * (1 + (i % 32)),
                os_family=OsFamily.linux if i % 2 == 0 else OsFamily.windows,
                os_distribution="Debian" if i % 2 == 0 else "Windows Server",
                os_version="12" if i % 2 == 0 else "2022",
                owner=f"owner-{i % 7}",
                business_owner=f"business-{i % 4}",
                technical_owner=f"technical-{i % 6}",
                pmp_enabled=i % 3 == 0,
                monitoring_enabled=i % 4 != 0,
                backup_enabled=i % 5 != 0,
                ha_enabled=i % 6 == 0,
                tags=["perf", f"group-{i % 8}"],
                health_score=75,
                created_by_id=admin.id,
                updated_by_id=admin.id,
            )
        )
    db.add_all(rows)
    db.commit()


def _assert_shape(name: str, payload: dict[str, Any]) -> None:
    if name == "dashboard":
        assert payload["total"] == VM_COUNT
        for key in ["by_status", "by_environment", "by_criticality", "by_os_family"]:
            assert isinstance(payload[key], dict), key
        for key in ["shutdown_stale", "decommission_overdue", "missing_ip"]:
            assert isinstance(payload[key], list), key
    elif name == "reports_summary":
        assert payload["total_vms"] == VM_COUNT
        assert set(payload["counts"]) == {
            "linux",
            "windows",
            "production",
            "monitoring",
            "applications",
            "owner",
            "pmp_access",
            "decommission",
        }
    elif name == "vm_list":
        assert payload["total"] == VM_COUNT
        assert isinstance(payload["items"], list)
        assert payload["items"]
        assert payload["items"][0]["name"] == "perf-vm-000"
    else:  # pragma: no cover - fixed ENDPOINTS protects this branch
        raise AssertionError(name)


def _measure_request(client: TestClient, name: str, path: str) -> tuple[float, int]:
    query_count = 0

    def before_cursor_execute(*_args: Any, **_kwargs: Any) -> None:
        nonlocal query_count
        query_count += 1

    def after_cursor_execute(*_args: Any, **_kwargs: Any) -> None:
        return None

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    event.listen(engine, "after_cursor_execute", after_cursor_execute)
    try:
        start = time.perf_counter_ns()
        response = client.get(path)
        duration_ms = (time.perf_counter_ns() - start) / 1_000_000
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
        event.remove(engine, "after_cursor_execute", after_cursor_execute)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert isinstance(payload, dict)
    _assert_shape(name, payload)
    return duration_ms, query_count


def test_endpoint_performance_baseline() -> None:
    output = os.environ.get("PERF_OUTPUT")
    assert output, "PERF_OUTPUT is required"
    _reset_public_schema(engine)
    with SessionLocal() as db:
        _create_admin_and_vms(db)

    with TestClient(app) as client:
        login_response = client.post(
            "/api/auth/login",
            json={"email": "perf-admin@example.com", "password": "correct horse battery staple"},
        )
        assert login_response.status_code == 200, login_response.text
        assert client.cookies.get("inventorymgr_session")

        endpoints: dict[str, dict[str, Any]] = {}
        for name, path in ENDPOINTS.items():
            for _ in range(WARMUPS):
                _measure_request(client, name, path)
            durations_ms: list[float] = []
            query_counts: list[int] = []
            for _ in range(SAMPLES):
                duration_ms, query_count = _measure_request(client, name, path)
                durations_ms.append(duration_ms)
                query_counts.append(query_count)
            endpoints[name] = {
                "durations_ms": durations_ms,
                "query_counts": query_counts,
                "median_duration_ms": sorted(durations_ms)[len(durations_ms) // 2],
                "median_queries": sorted(query_counts)[len(query_counts) // 2],
            }

    data = {
        "metadata": {
            "backend_warmups": WARMUPS,
            "backend_samples": SAMPLES,
            "vm_count": VM_COUNT,
            "git_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        },
        "endpoints": endpoints,
    }
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
