import csv
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes.reports import CSV_COLUMNS
from app.db.models import Vm
from tests.conftest import create_user, create_vm_row, login


def test_report_columns_are_model_fields() -> None:
    # Regression guard: this list once carried `vcpu` and `memory_gb`, which are not model fields,
    # so both columns shipped empty.
    assert set(CSV_COLUMNS) - {column.name for column in Vm.__table__.columns} == set()


def test_report_carries_identity_and_capacity(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    create_vm_row(
        db_session,
        user,
        name="rep-01",
        cpu_cores=6,
        memory_mb=8192,
        external_id="vm-900",
        sr_id="SR-77",
        os_family="linux",
    )
    login(client, user.email)

    response = client.get("/api/reports/linux", params={"format": "csv"})

    assert response.status_code == 200
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["cpu_cores"] == "6"
    assert row["memory_mb"] == "8192"
    assert row["external_id"] == "vm-900"
    assert row["sr_id"] == "SR-77"
