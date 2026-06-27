import uuid
from typing import Any

from fastapi import HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    Criticality,
    Environment,
    Lifecycle,
    Platform,
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    VmStatus,
    now_utc,
)
from app.schemas.vms import VmCreate, VmRead, VmUpdate

IDENTITY_ERROR = "VM identity already exists"


def _raise_identity_conflict(exc: IntegrityError) -> None:
    if isinstance(exc.orig, UniqueViolation) or "uq_vms_platform" in str(exc.orig):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=IDENTITY_ERROR) from exc
    raise exc


def create_vm(db: Session, payload: VmCreate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump()
    vm = Vm(**values, created_by_id=user.id, updated_by_id=user.id)
    db.add(vm)
    try:
        if commit:
            db.commit()
            db.refresh(vm)
        else:
            db.flush()
    except IntegrityError as exc:
        db.rollback()
        _raise_identity_conflict(exc)
    return vm


def _write_audit(db: Session, vm: Vm, user: User, changes: dict[str, tuple[Any, Any]]) -> None:
    for field, (old, new) in changes.items():
        db.add(AuditLog(
            vm_id=vm.id,
            user_id=user.id,
            field_name=field,
            old_value=str(old) if old is not None else None,
            new_value=str(new) if new is not None else None,
            changed_at=now_utc(),
        ))


def update_vm(db: Session, vm: Vm, payload: VmUpdate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude_unset=True)
    changes: dict[str, tuple[Any, Any]] = {}
    for key, new_value in values.items():
        old_value = getattr(vm, key)
        if old_value != new_value:
            changes[key] = (old_value, new_value)
        setattr(vm, key, new_value)
    vm.updated_by_id = user.id
    if changes:
        _write_audit(db, vm, user, changes)
    try:
        if commit:
            db.commit()
            db.refresh(vm)
        else:
            db.flush()
    except IntegrityError as exc:
        db.rollback()
        _raise_identity_conflict(exc)
    return vm


def delete_vm(db: Session, vm: Vm) -> None:
    db.delete(vm)
    db.commit()


def get_vm_or_404(db: Session, vm_id: uuid.UUID) -> Vm:
    vm = db.get(Vm, vm_id)
    if vm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VM not found")
    return vm


_DETAIL_OPTIONS = [
    selectinload(Vm.disks),
    selectinload(Vm.networks),
    selectinload(Vm.applications),
    selectinload(Vm.attachments),
]


def get_vm_detail_or_404(db: Session, vm_id: uuid.UUID) -> Vm:
    vm = db.scalar(select(Vm).options(*_DETAIL_OPTIONS).where(Vm.id == vm_id))
    if vm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VM not found")
    return vm


def to_vm_read(vm: Vm) -> VmRead:
    r = VmRead.model_validate(vm)
    return r.model_copy(update={"health_score": vm.health_score})


def clone_vm(db: Session, vm: Vm, user: User) -> Vm:
    exclude = {"id", "created_at", "updated_at", "created_by_id", "updated_by_id"}
    values = {
        col.name: getattr(vm, col.name)
        for col in Vm.__table__.columns
        if col.name not in exclude
    }
    values["name"] = f"{vm.name}-copy"
    values["external_id"] = None
    cloned = Vm(**values, created_by_id=user.id, updated_by_id=user.id)
    db.add(cloned)
    db.flush()
    for disk in vm.disks:
        db.add(VmDisk(
            vm_id=cloned.id, disk_name=disk.disk_name, storage_name=disk.storage_name,
            size_gb=disk.size_gb, storage_type=disk.storage_type, sort_order=disk.sort_order,
        ))
    for net in vm.networks:
        db.add(VmNetwork(
            vm_id=cloned.id, ip_address=net.ip_address, vlan=net.vlan,
            gateway=net.gateway, sort_order=net.sort_order,
        ))
    for app in vm.applications:
        db.add(VmApplication(
            vm_id=cloned.id, app_name=app.app_name,
            app_owner=app.app_owner, description=app.description,
        ))
    db.commit()
    return get_vm_detail_or_404(db, cloned.id)


def apply_vm_filters(
    stmt: Select[tuple[Vm]],
    *,
    q: str | None = None,
    platform: Platform | None = None,
    cluster: str | None = None,
    status_value: VmStatus | None = None,
    environment: Environment | None = None,
    criticality: Criticality | None = None,
    lifecycle: Lifecycle | None = None,
    monitoring_enabled: bool | None = None,
) -> Select[tuple[Vm]]:
    if q:
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Vm.name).like(pattern),
                func.lower(Vm.cluster).like(pattern),
                func.lower(func.coalesce(Vm.owner, "")).like(pattern),
                func.lower(func.coalesce(Vm.fqdn, "")).like(pattern),
                func.lower(func.coalesce(Vm.department, "")).like(pattern),
            )
        )
    if platform:
        stmt = stmt.where(Vm.platform == platform)
    if cluster:
        stmt = stmt.where(Vm.cluster == cluster.strip())
    if status_value:
        stmt = stmt.where(Vm.status == status_value)
    if environment:
        stmt = stmt.where(Vm.environment == environment)
    if criticality:
        stmt = stmt.where(Vm.criticality == criticality)
    if lifecycle:
        stmt = stmt.where(Vm.lifecycle == lifecycle)
    if monitoring_enabled is not None:
        stmt = stmt.where(Vm.monitoring_enabled == monitoring_enabled)
    return stmt


def list_vms(db: Session, filters: dict[str, Any], limit: int, offset: int) -> tuple[list[Vm], int]:
    base = apply_vm_filters(select(Vm), **filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(
        base.options(
            selectinload(Vm.disks),
            selectinload(Vm.networks),
            selectinload(Vm.applications),
        )
        .order_by(Vm.updated_at.desc(), Vm.name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return list(items), total
