import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import AdminUser, Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import Criticality, Lifecycle, Platform, Vm, VmStatus
from app.schemas.vms import VmCreate, VmList, VmRead, VmUpdate
from app.services.vms import create_vm as create_vm_service
from app.services.vms import delete_vm as delete_vm_service
from app.services.vms import get_vm_or_404, list_vms
from app.services.vms import update_vm as update_vm_service

router = APIRouter()


@router.get("", response_model=VmList)
def list_inventory(
    db: DbSession,
    _: ViewerUser,
    q: str | None = None,
    platform: Platform | None = None,
    environment: str | None = None,
    cluster: str | None = None,
    host: str | None = None,
    status_value: Annotated[VmStatus | None, Query(alias="status")] = None,
    criticality: Criticality | None = None,
    lifecycle: Lifecycle | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> VmList:
    items, total = list_vms(
        db,
        {
            "q": q,
            "platform": platform,
            "environment": environment,
            "cluster": cluster,
            "host": host,
            "status_value": status_value,
            "criticality": criticality,
            "lifecycle": lifecycle,
        },
        limit,
        offset,
    )
    return VmList(
        items=[VmRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=VmRead, status_code=status.HTTP_201_CREATED)
def create_vm(payload: VmCreate, db: DbSession, current_user: EditorUser, _: Csrf) -> Vm:
    return create_vm_service(db, payload, current_user)


@router.get("/{vm_id}", response_model=VmRead)
def get_vm(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> Vm:
    return get_vm_or_404(db, vm_id)


@router.patch("/{vm_id}", response_model=VmRead)
def update_vm(
    vm_id: uuid.UUID, payload: VmUpdate, db: DbSession, current_user: EditorUser, _: Csrf
) -> Vm:
    vm = get_vm_or_404(db, vm_id)
    return update_vm_service(db, vm, payload, current_user)


@router.delete("/{vm_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vm(vm_id: uuid.UUID, db: DbSession, _: AdminUser, __: Csrf) -> None:
    vm = get_vm_or_404(db, vm_id)
    delete_vm_service(db, vm)
