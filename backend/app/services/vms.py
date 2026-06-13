import uuid
from typing import Any

from fastapi import HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Criticality, Lifecycle, Platform, User, Vm, VmStatus
from app.schemas.vms import VmCreate, VmUpdate

IDENTITY_ERROR = "VM identity already exists"


def _raise_identity_conflict(exc: IntegrityError) -> None:
    if isinstance(exc.orig, UniqueViolation) or "uq_vms_platform_environment" in str(exc.orig):
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


def update_vm(db: Session, vm: Vm, payload: VmUpdate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude_unset=True)
    for key, value in values.items():
        setattr(vm, key, value)
    vm.updated_by_id = user.id
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


def apply_vm_filters(
    stmt: Select[tuple[Vm]],
    *,
    q: str | None = None,
    platform: Platform | None = None,
    environment: str | None = None,
    cluster: str | None = None,
    host: str | None = None,
    status_value: VmStatus | None = None,
    criticality: Criticality | None = None,
    lifecycle: Lifecycle | None = None,
) -> Select[tuple[Vm]]:
    if q:
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Vm.name).like(pattern),
                func.lower(Vm.environment).like(pattern),
                func.lower(Vm.cluster).like(pattern),
                func.lower(Vm.host).like(pattern),
                func.lower(func.coalesce(Vm.owner, "")).like(pattern),
            )
        )
    if platform:
        stmt = stmt.where(Vm.platform == platform)
    if environment:
        stmt = stmt.where(Vm.environment == environment.strip())
    if cluster:
        stmt = stmt.where(Vm.cluster == cluster.strip())
    if host:
        stmt = stmt.where(Vm.host == host.strip())
    if status_value:
        stmt = stmt.where(Vm.status == status_value)
    if criticality:
        stmt = stmt.where(Vm.criticality == criticality)
    if lifecycle:
        stmt = stmt.where(Vm.lifecycle == lifecycle)
    return stmt


def list_vms(db: Session, filters: dict[str, Any], limit: int, offset: int) -> tuple[list[Vm], int]:
    base = apply_vm_filters(select(Vm), **filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(
        base.order_by(Vm.updated_at.desc(), Vm.name.asc()).limit(limit).offset(offset)
    ).all()
    return list(items), total
