import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    compute_health_score,
)
from app.schemas.vms import VmRead
from app.services.vm_filters import (
    SHUTDOWN_STALE_DAYS,
    SORT_COLUMNS,
    SORT_PATTERN,
    FilterOperator,
    apply_vm_filters,
    decommission_overdue_condition,
    duplicate_ip_condition,
    list_vms,
    missing_ip_condition,
    non_template_condition,
    shutdown_since_expr,
    shutdown_stale_condition,
    template_tag_condition,
)
from app.services.vm_mutations import (
    IDENTITY_ERROR,
    create_vm,
    delete_vm,
    recompute_health,
    update_vm,
)

__all__ = [
    "IDENTITY_ERROR",
    "SHUTDOWN_STALE_DAYS",
    "SORT_COLUMNS",
    "SORT_PATTERN",
    "FilterOperator",
    "apply_vm_filters",
    "clone_vm",
    "create_vm",
    "decommission_overdue_condition",
    "delete_vm",
    "get_vm_detail_or_404",
    "get_vm_or_404",
    "list_vms",
    "duplicate_ip_condition",
    "missing_ip_condition",
    "non_template_condition",
    "recompute_health",
    "shutdown_since_expr",
    "shutdown_stale_condition",
    "template_tag_condition",
    "update_vm",
]


def get_vm_or_404(db: Session, vm_id: uuid.UUID) -> Vm:
    vm = db.get(Vm, vm_id)
    if vm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VM not found")
    return vm


_DETAIL_OPTIONS = [
    selectinload(Vm.disks),
    selectinload(Vm.networks),
    selectinload(Vm.applications),
]


def get_vm_detail_or_404(db: Session, vm_id: uuid.UUID) -> Vm:
    vm = db.scalar(select(Vm).options(*_DETAIL_OPTIONS).where(Vm.id == vm_id))
    if vm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VM not found")
    return vm


def to_vm_read(vm: Vm) -> VmRead:
    return VmRead.model_validate(vm)


def clone_vm(db: Session, vm: Vm, user: User) -> Vm:
    exclude = {"id", "created_at", "updated_at", "created_by_id", "updated_by_id"}
    values = {
        col.name: getattr(vm, col.name) for col in Vm.__table__.columns if col.name not in exclude
    }
    values["name"] = f"{vm.name}-copy"
    values["external_id"] = None
    cloned = Vm(**values, created_by_id=user.id, updated_by_id=user.id)
    db.add(cloned)
    db.flush()
    for disk in vm.disks:
        db.add(
            VmDisk(
                vm_id=cloned.id,
                disk_name=disk.disk_name,
                storage_name=disk.storage_name,
                size_gb=disk.size_gb,
                storage_type=disk.storage_type,
                sort_order=disk.sort_order,
            )
        )
    for net in vm.networks:
        db.add(
            VmNetwork(
                vm_id=cloned.id,
                ip_address=net.ip_address,
                role=net.role,
                sort_order=net.sort_order,
            )
        )
    for app in vm.applications:
        db.add(
            VmApplication(
                vm_id=cloned.id,
                app_name=app.app_name,
                app_owner=app.app_owner,
                description=app.description,
            )
        )
    db.commit()
    cloned_full = get_vm_detail_or_404(db, cloned.id)
    cloned_full.health_score = compute_health_score(cloned_full)
    db.commit()
    return cloned_full
