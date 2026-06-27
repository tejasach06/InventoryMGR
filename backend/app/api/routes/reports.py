import csv
import io
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, ViewerUser
from app.db.models import Vm

router = APIRouter()

REPORTS: dict[str, dict] = {
    "linux": {"label": "Linux Inventory", "filter": lambda q: q.where(Vm.os_family == "linux")},
    "windows": {"label": "Windows Inventory", "filter": lambda q: q.where(Vm.os_family == "windows")},
    "production": {"label": "Production Inventory", "filter": lambda q: q.where(Vm.environment == "production")},
    "monitoring": {"label": "Monitoring Status", "filter": lambda q: q},
    "applications": {"label": "Application Inventory", "filter": lambda q: q},
    "owner": {"label": "Owner Report", "filter": lambda q: q.order_by(Vm.business_owner.asc())},
    "department": {"label": "Department Report", "filter": lambda q: q.order_by(Vm.department.asc())},
    "lifecycle": {"label": "Lifecycle Report", "filter": lambda q: q.order_by(Vm.decommission_date.asc())},
}

CSV_COLUMNS = [
    "name", "fqdn", "platform", "cluster", "node", "environment", "status",
    "criticality", "vcpu", "memory_gb", "os_family", "os_distribution", "os_version",
    "business_owner", "technical_owner", "department",
    "monitoring_enabled", "last_patch_date", "last_vuln_scan_date", "decommission_date",
    "description", "tags",
]


def _vm_to_row(vm: Vm) -> dict:
    row: dict = {col: getattr(vm, col, None) for col in CSV_COLUMNS}
    row["tags"] = ",".join(vm.tags or [])
    row["monitoring_enabled"] = "Yes" if vm.monitoring_enabled else "No"
    row["applications"] = ",".join(a.app_name for a in vm.applications) if "applications" in vm.__dict__ else ""
    return row


def _stream_csv(vms: list[Vm], report_name: str) -> StreamingResponse:
    def generate():
        buf = io.StringIO()
        cols = CSV_COLUMNS + ["applications"]
        writer = csv.DictWriter(buf, fieldnames=cols)
        writer.writeheader()
        yield buf.getvalue()
        for vm in vms:
            buf.seek(0)
            buf.truncate()
            writer.writerow(_vm_to_row(vm))
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{report_name}.csv"'},
    )


@router.get("/{report_name}")
def get_report(
    report_name: str,
    db: DbSession,
    _: ViewerUser,
    format: Annotated[str, Query(pattern="^csv$")] = "csv",
) -> StreamingResponse:
    if report_name not in REPORTS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown report '{report_name}'. Available: {', '.join(REPORTS)}",
        )
    report = REPORTS[report_name]
    base = select(Vm).options(selectinload(Vm.applications))
    query = report["filter"](base).order_by(Vm.name.asc())
    vms = list(db.scalars(query))
    return _stream_csv(vms, report_name)
