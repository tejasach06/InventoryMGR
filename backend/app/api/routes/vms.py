import csv
import io
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import (
    Criticality,
    Environment,
    Lifecycle,
    OsFamily,
    Platform,
    Vm,
    VmApplication,
    VmStatus,
)
from app.schemas.vms import VmCreate, VmList, VmRead, VmUpdate
from app.services.vms import (
    FilterOperator,
    apply_vm_filters,
    get_vm_detail_or_404,
    get_vm_or_404,
    list_vms,
    to_vm_read,
)
from app.services.vms import (
    clone_vm as clone_vm_service,
)
from app.services.vms import (
    create_vm as create_vm_service,
)
from app.services.vms import (
    delete_vm as delete_vm_service,
)
from app.services.vms import (
    update_vm as update_vm_service,
)

router = APIRouter()


@dataclass
class VmFilterParams:
    q: str | None = None
    platform: Annotated[list[Platform] | None, Query()] = None
    platform_op: FilterOperator = FilterOperator.eq
    cluster: Annotated[list[str] | None, Query()] = None
    status_value: Annotated[list[VmStatus] | None, Query(alias="status")] = None
    status_op: FilterOperator = FilterOperator.eq
    environment: Annotated[list[Environment] | None, Query()] = None
    environment_op: FilterOperator = FilterOperator.eq
    criticality: Annotated[list[Criticality] | None, Query()] = None
    criticality_op: FilterOperator = FilterOperator.eq
    lifecycle: Annotated[list[Lifecycle] | None, Query()] = None
    monitoring_enabled: bool | None = None
    monitoring_enabled_op: FilterOperator = FilterOperator.eq
    node: Annotated[list[str] | None, Query()] = None
    node_op: FilterOperator = FilterOperator.eq
    os_family: Annotated[list[OsFamily] | None, Query()] = None
    os_family_op: FilterOperator = FilterOperator.eq
    owner: Annotated[list[str] | None, Query()] = None
    owner_op: FilterOperator = FilterOperator.eq
    pmp_enabled: bool | None = None
    pmp_enabled_op: FilterOperator = FilterOperator.eq
    tag: Annotated[list[str] | None, Query()] = None
    tag_op: FilterOperator = FilterOperator.eq
    application: Annotated[list[str] | None, Query()] = None
    application_op: FilterOperator = FilterOperator.contains
    health: Annotated[str | None, Query(pattern="^(below_50|below_75|complete)$")] = None


@router.get("", response_model=VmList)
def list_inventory(
    db: DbSession,
    _: ViewerUser,
    filters: Annotated[VmFilterParams, Depends()],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> VmList:
    items, total = list_vms(db, vars(filters), limit, offset)
    return VmList(
        items=[to_vm_read(item) for item in items],
        total=total, limit=limit, offset=offset,
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


@router.get("/clusters", response_model=list[str])
def list_clusters(db: DbSession, _: ViewerUser) -> list[str]:
    rows = db.scalars(
        select(Vm.cluster).where(Vm.cluster.is_not(None)).distinct().order_by(Vm.cluster.asc())
    ).all()
    return list(rows)


@router.get("/nodes", response_model=list[str])
def list_nodes(db: DbSession, _: ViewerUser) -> list[str]:
    rows = db.scalars(
        select(Vm.node).where(Vm.node.is_not(None)).distinct().order_by(Vm.node.asc())
    ).all()
    return [node for node in rows if node]


@router.get("/applications", response_model=list[str])
def list_applications(db: DbSession, _: ViewerUser) -> list[str]:
    rows = db.scalars(
        select(VmApplication.app_name).distinct().order_by(VmApplication.app_name.asc())
    ).all()
    return list(rows)


@router.get("/tags", response_model=list[str])
def list_tags(db: DbSession, _: ViewerUser) -> list[str]:
    tag = func.jsonb_array_elements_text(Vm.tags).label("tag")
    rows = db.scalars(select(tag).distinct().order_by(tag)).all()
    return [t for t in rows if t]


_EXPORT_COLS = [
    "name", "fqdn", "platform", "cluster", "node", "environment", "status",
    "criticality", "vcpu", "memory_gb", "os_family", "os_distribution", "os_version",
    "business_owner", "technical_owner", "pmp_enabled",
    "monitoring_enabled", "last_patch_date", "last_vuln_scan_date", "decommission_date",
    "description", "tags",
]


@router.get("/export", response_class=StreamingResponse)
def export_vms(
    db: DbSession,
    _: ViewerUser,
    filters: Annotated[VmFilterParams, Depends()],
    ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    all_vms: Annotated[bool, Query(alias="all")] = False,
) -> StreamingResponse:
    if ids:
        base_q = select(Vm).where(Vm.id.in_(ids))
    elif all_vms:
        base_q = select(Vm)
    else:
        base_q = apply_vm_filters(select(Vm), **vars(filters))
    vms = list(db.scalars(base_q.options(selectinload(Vm.applications)).order_by(Vm.name.asc())))

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


