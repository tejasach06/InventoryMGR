import csv
import io
import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import Criticality, Environment, Lifecycle, Platform, Vm, VmApplication, VmStatus
from app.schemas.vms import VmCreate, VmList, VmRead, VmUpdate
from app.services.vms import clone_vm as clone_vm_service
from app.services.vms import create_vm as create_vm_service
from app.services.vms import delete_vm as delete_vm_service
from app.services.vms import get_vm_detail_or_404, get_vm_or_404, list_vms, to_vm_read
from app.services.vms import update_vm as update_vm_service

router = APIRouter()


@router.get("", response_model=VmList)
def list_inventory(
    db: DbSession,
    _: ViewerUser,
    q: str | None = None,
    platform: Platform | None = None,
    cluster: str | None = None,
    status_value: Annotated[VmStatus | None, Query(alias="status")] = None,
    environment: Environment | None = None,
    criticality: Criticality | None = None,
    lifecycle: Lifecycle | None = None,
    monitoring_enabled: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> VmList:
    items, total = list_vms(
        db,
        {
            "q": q,
            "platform": platform,
            "cluster": cluster,
            "status_value": status_value,
            "environment": environment,
            "criticality": criticality,
            "lifecycle": lifecycle,
            "monitoring_enabled": monitoring_enabled,
        },
        limit,
        offset,
    )
    return VmList(
        items=[to_vm_read(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=VmRead, status_code=status.HTTP_201_CREATED)
def create_vm(payload: VmCreate, db: DbSession, current_user: EditorUser, _: Csrf) -> VmRead:
    vm = create_vm_service(db, payload, current_user)
    return to_vm_read(vm)


@router.get("/owners", response_model=list[str])
def list_owners(db: DbSession, _: ViewerUser) -> list[str]:
    rows = db.scalars(
        select(Vm.owner).where(Vm.owner.is_not(None)).distinct().order_by(Vm.owner.asc())
    ).all()
    return [owner for owner in rows if owner]


@router.get("/{vm_id}", response_model=VmRead)
def get_vm(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> VmRead:
    vm = get_vm_detail_or_404(db, vm_id)
    return to_vm_read(vm)


@router.post("/{vm_id}/clone", response_model=VmRead, status_code=status.HTTP_201_CREATED)
def clone_vm(vm_id: uuid.UUID, db: DbSession, current_user: EditorUser, _: Csrf) -> VmRead:
    vm = get_vm_detail_or_404(db, vm_id)
    cloned = clone_vm_service(db, vm, current_user)
    return to_vm_read(cloned)


@router.patch("/{vm_id}", response_model=VmRead)
def update_vm(
    vm_id: uuid.UUID, payload: VmUpdate, db: DbSession, current_user: EditorUser, _: Csrf
) -> VmRead:
    vm = get_vm_or_404(db, vm_id)
    updated = update_vm_service(db, vm, payload, current_user)
    return to_vm_read(updated)


@router.delete("/{vm_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vm(vm_id: uuid.UUID, db: DbSession, _: AdminUser, __: Csrf) -> None:
    vm = get_vm_or_404(db, vm_id)
    delete_vm_service(db, vm)


_EXPORT_COLS = [
    "name", "fqdn", "platform", "cluster", "node", "environment", "status",
    "criticality", "vcpu", "memory_gb", "os_family", "os_distribution", "os_version",
    "business_owner", "technical_owner", "department",
    "monitoring_enabled", "last_patch_date", "last_vuln_scan_date", "decommission_date",
    "description", "tags",
]


@router.get("/export", response_class=StreamingResponse)
def export_vms(db: DbSession, _: ViewerUser) -> StreamingResponse:
    vms = list(db.scalars(
        select(Vm).options(selectinload(Vm.applications)).order_by(Vm.name.asc())
    ))

    def generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLS + ["applications"])
        writer.writeheader()
        yield buf.getvalue()
        for vm in vms:
            buf.seek(0)
            buf.truncate()
            row = {col: getattr(vm, col, None) for col in _EXPORT_COLS}
            row["tags"] = ",".join(vm.tags or [])
            row["monitoring_enabled"] = "Yes" if vm.monitoring_enabled else "No"
            row["applications"] = ",".join(a.app_name for a in vm.applications)
            writer.writerow(row)
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vm-inventory.csv"'},
    )
