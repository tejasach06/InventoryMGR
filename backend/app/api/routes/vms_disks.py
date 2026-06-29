import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import VmDisk
from app.schemas.vms import DiskCreate, DiskRead
from app.services.vms import get_vm_or_404, recompute_health

router = APIRouter()


@router.get("", response_model=list[DiskRead])
def list_disks(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list[VmDisk]:
    get_vm_or_404(db, vm_id)
    return list(db.scalars(select(VmDisk).where(VmDisk.vm_id == vm_id).order_by(VmDisk.sort_order)))


@router.post("", response_model=DiskRead, status_code=status.HTTP_201_CREATED)
def add_disk(
    vm_id: uuid.UUID, payload: DiskCreate, db: DbSession, _: EditorUser, __: Csrf
) -> VmDisk:
    get_vm_or_404(db, vm_id)
    disk = VmDisk(vm_id=vm_id, **payload.model_dump())
    db.add(disk)
    db.commit()
    db.refresh(disk)
    recompute_health(db, vm_id)
    return disk


@router.patch("/{disk_id}", response_model=DiskRead)
def update_disk(
    vm_id: uuid.UUID,
    disk_id: uuid.UUID,
    payload: DiskCreate,
    db: DbSession,
    _: EditorUser,
    __: Csrf,
) -> VmDisk:
    disk = db.scalar(select(VmDisk).where(VmDisk.id == disk_id, VmDisk.vm_id == vm_id))
    if disk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Disk not found")
    for key, value in payload.model_dump().items():
        setattr(disk, key, value)
    db.commit()
    db.refresh(disk)
    return disk


@router.delete("/{disk_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_disk(
    vm_id: uuid.UUID, disk_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
) -> None:
    disk = db.scalar(select(VmDisk).where(VmDisk.id == disk_id, VmDisk.vm_id == vm_id))
    if disk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Disk not found")
    db.delete(disk)
    db.commit()
    recompute_health(db, vm_id)
