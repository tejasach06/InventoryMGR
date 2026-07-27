import csv
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes.vms import _EXPORT_SCALAR_COLS
from app.db.models import Vm, VmApplication, VmDisk, VmNetwork
from tests.conftest import create_user, create_vm_row, login

# Columns a documentation export has no business carrying.
_NOT_EXPORTED = {"id", "created_by_id", "updated_by_id"}


def test_every_model_column_is_exported() -> None:
    model_columns = {col.name for col in Vm.__table__.columns} - _NOT_EXPORTED

    # Regression guard: the old list carried `vcpu` and `memory_gb`, which are
    # not model fields, so both columns shipped empty on every export.
    assert model_columns - set(_EXPORT_SCALAR_COLS) == set()
    assert set(_EXPORT_SCALAR_COLS) - model_columns == set()


def test_export_carries_values_and_children(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    vm = create_vm_row(db_session, user, name="ex-01", cpu_cores=6, memory_mb=8192)
    db_session.add_all([
        VmDisk(vm_id=vm.id, disk_name="scsi0", size_gb=120, storage_name="ssd", storage_type="thin"),
        VmNetwork(vm_id=vm.id, ip_address="10.0.0.5", role="private", vlan=42, gateway="10.0.0.1"),
        VmApplication(vm_id=vm.id, app_name="nginx", app_owner="web-team"),
    ])
    db_session.commit()
    login(client, user.email)

    response = client.get("/api/vms/export")

    assert response.status_code == 200
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["cpu_cores"] == "6"
    assert row["disks"] == "scsi0:120:ssd:thin"
    assert row["private_ip"] == "10.0.0.5:42:10.0.0.1"
    assert row["applications"] == "nginx:web-team"
    assert row["monitoring_enabled"] in {"true", "false"}
def test_xlsx_export_has_a_header_row_for_every_column(
    client: TestClient, db_session: Session
) -> None:
    import zipfile

    user = create_user(db_session, email="admin@example.com", role="admin")
    create_vm_row(db_session, user, name="ex-01")
    login(client, user.email)

    response = client.get("/api/vms/export", params={"format": "xlsx"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "vm-inventory.xlsx" in response.headers["content-disposition"]
    # A valid xlsx is a zip holding the workbook part; shared strings must carry
    # the header labels.
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    shared = archive.read("xl/sharedStrings.xml").decode()
    for column in ("name", "cpu_cores", "applications"):
        assert f"<t>{column}</t>" in shared


def test_csv_stays_the_default_format(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="admin@example.com", role="admin")
    login(client, user.email)

    response = client.get("/api/vms/export")

    assert response.headers["content-type"].startswith("text/csv")
