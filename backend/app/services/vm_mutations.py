import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    User,
    Vm,
    VmDisk,
    VmNetwork,
    compute_health_score,
    now_utc,
)
from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmUpdate

IDENTITY_ERROR = "VM identity already exists"


def _raise_identity_conflict(exc: IntegrityError) -> None:
    msg = str(exc.orig) if exc.orig else str(exc)
    if isinstance(exc.orig, UniqueViolation) or "uq_vms_platform" in msg or "UNIQUE constraint failed" in msg:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=IDENTITY_ERROR) from exc
    raise exc



def _sync_disks(db: Session, vm: Vm, disks: Sequence[DiskCreate]) -> None:
    db.query(VmDisk).filter(VmDisk.vm_id == vm.id).delete()
    for i, disk in enumerate(disks):
        db.add(
            VmDisk(
                vm_id=vm.id,
                disk_name=disk.disk_name,
                storage_name=disk.storage_name,
                size_gb=disk.size_gb,
                storage_type=disk.storage_type,
                sort_order=disk.sort_order if disk.sort_order is not None else i,
            )
        )


def _sync_networks(db: Session, vm: Vm, networks: Sequence[NetworkCreate]) -> None:
    db.query(VmNetwork).filter(VmNetwork.vm_id == vm.id).delete()
    for i, network in enumerate(networks):
        db.add(
            VmNetwork(
                vm_id=vm.id,
                ip_address=network.ip_address,
                role=network.role,
                sort_order=network.sort_order if network.sort_order is not None else i,
            )
        )


def create_vm(db: Session, payload: VmCreate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude={"disks", "networks"})
    vm = Vm(**values, created_by_id=user.id, updated_by_id=user.id)
    db.add(vm)
    try:
        if commit:
            db.flush()
            if payload.disks:
                _sync_disks(db, vm, payload.disks)
            if payload.networks:
                _sync_networks(db, vm, payload.networks)
            db.commit()
            db.refresh(vm)
            vm.health_score = compute_health_score(vm)
            db.commit()
        else:
            db.flush()
    except IntegrityError as exc:
        db.rollback()
        _raise_identity_conflict(exc)
    return vm


def _write_audit(db: Session, vm: Vm, user: User, changes: dict[str, tuple[Any, Any]]) -> None:
    for field, (old, new) in changes.items():
        db.add(
            AuditLog(
                vm_id=vm.id,
                user_id=user.id,
                field_name=field,
                old_value=str(old) if old is not None else None,
                new_value=str(new) if new is not None else None,
                changed_at=now_utc(),
            )
        )


def update_vm(db: Session, vm: Vm, payload: VmUpdate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude_unset=True, exclude={"disks", "networks"})
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
            db.flush()
            if "disks" in payload.model_fields_set:
                _sync_disks(db, vm, payload.disks)
            if "networks" in payload.model_fields_set:
                _sync_networks(db, vm, payload.networks)
            db.commit()
            db.refresh(vm)
            vm.health_score = compute_health_score(vm)
            db.commit()
        else:
            db.flush()
    except IntegrityError as exc:
        db.rollback()
        _raise_identity_conflict(exc)
    return vm


def delete_vm(db: Session, vm: Vm) -> None:
    db.delete(vm)
    db.commit()


def recompute_health(db: Session, vm_id: uuid.UUID) -> None:
    """Load VM + children, recompute health_score, commit."""
    vm = db.scalar(
        select(Vm)
        .options(selectinload(Vm.disks), selectinload(Vm.networks), selectinload(Vm.applications))
        .where(Vm.id == vm_id)
    )
    if vm is not None:
        vm.health_score = compute_health_score(vm)
        db.commit()
