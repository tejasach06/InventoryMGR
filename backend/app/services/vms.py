import uuid
from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import Select, String, cast, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    Criticality,
    Environment,
    Lifecycle,
    OsFamily,
    Platform,
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    VmStatus,
    VmType,
    compute_health_score,
    now_utc,
)
from app.schemas.vms import DiskCreate, NetworkCreate, VmCreate, VmRead, VmUpdate

IDENTITY_ERROR = "VM identity already exists"


def _raise_identity_conflict(exc: IntegrityError) -> None:
    if isinstance(exc.orig, UniqueViolation) or "uq_vms_platform" in str(exc.orig):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=IDENTITY_ERROR) from exc
    raise exc


def _apply_vm_type_lifecycle(vm: Vm) -> None:
    if vm.vm_type == VmType.temporary and vm.decommission_date is not None:
        vm.lifecycle = Lifecycle.retiring


def _sync_disks(db: Session, vm: Vm, disks: list[DiskCreate]) -> None:
    db.query(VmDisk).filter(VmDisk.vm_id == vm.id).delete()
    for i, disk in enumerate(disks):
        db.add(VmDisk(
            vm_id=vm.id,
            disk_name=disk.disk_name,
            storage_name=disk.storage_name,
            size_gb=disk.size_gb,
            storage_type=disk.storage_type,
            sort_order=disk.sort_order if disk.sort_order is not None else i,
        ))


def _sync_networks(db: Session, vm: Vm, networks: list[NetworkCreate]) -> None:
    db.query(VmNetwork).filter(VmNetwork.vm_id == vm.id).delete()
    for i, network in enumerate(networks):
        db.add(VmNetwork(
            vm_id=vm.id,
            ip_address=network.ip_address,
            role=network.role,
            vlan=network.vlan,
            gateway=network.gateway,
            sort_order=network.sort_order if network.sort_order is not None else i,
        ))


def create_vm(db: Session, payload: VmCreate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude={"disks", "networks"})
    vm = Vm(**values, created_by_id=user.id, updated_by_id=user.id)
    _apply_vm_type_lifecycle(vm)
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
        db.add(AuditLog(
            vm_id=vm.id,
            user_id=user.id,
            field_name=field,
            old_value=str(old) if old is not None else None,
            new_value=str(new) if new is not None else None,
            changed_at=now_utc(),
        ))


def update_vm(db: Session, vm: Vm, payload: VmUpdate, user: User, *, commit: bool = True) -> Vm:
    values = payload.model_dump(exclude_unset=True, exclude={"disks", "networks"})
    changes: dict[str, tuple[Any, Any]] = {}
    for key, new_value in values.items():
        old_value = getattr(vm, key)
        if old_value != new_value:
            changes[key] = (old_value, new_value)
        setattr(vm, key, new_value)
    _apply_vm_type_lifecycle(vm)
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


def recompute_health(db: Session, vm_id: uuid.UUID) -> None:
    """Load VM + children, recompute health_score, commit."""
    vm = db.scalar(
        select(Vm).options(
            selectinload(Vm.disks), selectinload(Vm.networks), selectinload(Vm.applications)
        ).where(Vm.id == vm_id)
    )
    if vm is not None:
        vm.health_score = compute_health_score(vm)
        db.commit()


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
            vm_id=cloned.id, ip_address=net.ip_address, role=net.role, vlan=net.vlan,
            gateway=net.gateway, sort_order=net.sort_order,
        ))
    for app in vm.applications:
        db.add(VmApplication(
            vm_id=cloned.id, app_name=app.app_name,
            app_owner=app.app_owner, description=app.description,
        ))
    db.commit()
    cloned_full = get_vm_detail_or_404(db, cloned.id)
    cloned_full.health_score = compute_health_score(cloned_full)
    db.commit()
    return cloned_full


class FilterOperator(StrEnum):
    eq = "eq"
    contains = "contains"
    neq = "neq"


def _op_condition_list(column, values: list, operator: FilterOperator):
    # ponytail: 'contains' has no meaning for an IN-list of exact enum values, so it
    # collapses to 'eq' (IN) rather than raising. Only 'neq' gets distinct handling.
    if operator == FilterOperator.neq:
        return or_(column.notin_(values), column.is_(None))
    return column.in_(values)


def _op_condition(column, value: str, operator: FilterOperator, *, case_insensitive: bool = False):
    if case_insensitive:
        target = func.lower(func.coalesce(column, ""))
        needle = value.strip().lower()
    else:
        target = column
        needle = value.strip()
    if operator == FilterOperator.contains:
        like_target = target if case_insensitive else cast(target, String)
        return like_target.like(f"%{needle}%")
    if operator == FilterOperator.neq:
        # ponytail: target.is_(None) is a no-op for non-nullable columns and for the
        # case_insensitive path (already coalesced to ""), so this only changes
        # behavior for nullable columns like Vm.node / Vm.os_family.
        return or_(target != needle, target.is_(None))
    return target == needle


def apply_vm_filters(
    stmt: Select[tuple[Vm]],
    *,
    q: str | None = None,
    platform: list[Platform] | None = None,
    platform_op: FilterOperator = FilterOperator.eq,
    cluster: list[str] | None = None,
    status_value: list[VmStatus] | None = None,
    status_op: FilterOperator = FilterOperator.eq,
    environment: list[Environment] | None = None,
    environment_op: FilterOperator = FilterOperator.eq,
    criticality: list[Criticality] | None = None,
    criticality_op: FilterOperator = FilterOperator.eq,
    lifecycle: list[Lifecycle] | None = None,
    monitoring_enabled: bool | None = None,
    monitoring_enabled_op: FilterOperator = FilterOperator.eq,
    node: list[str] | None = None,
    node_op: FilterOperator = FilterOperator.eq,
    os_family: list[OsFamily] | None = None,
    os_family_op: FilterOperator = FilterOperator.eq,
    owner: list[str] | None = None,
    owner_op: FilterOperator = FilterOperator.eq,
    pmp_enabled: bool | None = None,
    pmp_enabled_op: FilterOperator = FilterOperator.eq,
    tag: list[str] | None = None,
    tag_op: FilterOperator = FilterOperator.eq,
    application: list[str] | None = None,
    application_op: FilterOperator = FilterOperator.contains,
    health: str | None = None,
) -> Select[tuple[Vm]]:
    if q:
        pattern = f"%{q.strip().lower()}%"
        net_subq = exists(select(VmNetwork.vm_id).where(
            VmNetwork.vm_id == Vm.id,
            func.lower(VmNetwork.ip_address).like(pattern),
        ))
        app_subq = exists(select(VmApplication.vm_id).where(
            VmApplication.vm_id == Vm.id,
            func.lower(VmApplication.app_name).like(pattern),
        ))
        stmt = stmt.where(or_(
            func.lower(Vm.name).like(pattern),
            func.lower(Vm.cluster).like(pattern),
            func.lower(func.coalesce(Vm.owner, "")).like(pattern),
            func.lower(func.coalesce(Vm.fqdn, "")).like(pattern),
            func.lower(func.coalesce(Vm.external_id, "")).like(pattern),
            func.lower(func.coalesce(Vm.sr_id, "")).like(pattern),
            func.lower(func.coalesce(Vm.os_name, "")).like(pattern),
            func.lower(func.coalesce(Vm.os_distribution, "")).like(pattern),
            func.lower(func.coalesce(Vm.os_version, "")).like(pattern),
            # ponytail: imprecise JSONB cast, fine for search
            cast(Vm.tags, String).like(f"%{q.strip()}%"),
            net_subq,
            app_subq,
        ))
    FILTER_SPECS = (
        (pmp_enabled, Vm.pmp_enabled, pmp_enabled_op, False),
    )
    for value, column, operator, case_insensitive in FILTER_SPECS:
        if value is not None:
            stmt = stmt.where(
                _op_condition(column, value, operator, case_insensitive=case_insensitive)
            )

    LIST_FILTER_SPECS = (
        (platform, Vm.platform, platform_op),
        (status_value, Vm.status, status_op),
        (environment, Vm.environment, environment_op),
        (criticality, Vm.criticality, criticality_op),
        (os_family, Vm.os_family, os_family_op),
        (lifecycle, Vm.lifecycle, FilterOperator.eq),
        (node, Vm.node, node_op),
        (cluster, Vm.cluster, FilterOperator.eq),
    )
    for values_list, column, operator in LIST_FILTER_SPECS:
        if values_list:
            stmt = stmt.where(_op_condition_list(column, values_list, operator))

    if monitoring_enabled is not None:
        stmt = stmt.where(
            Vm.monitoring_enabled != monitoring_enabled
            if monitoring_enabled_op == FilterOperator.neq
            else Vm.monitoring_enabled == monitoring_enabled
        )
    if owner:
        owner_matches = []
        for o in owner:
            needle = o.strip().lower()
            owner_matches.append(or_(
                func.lower(func.coalesce(Vm.owner, "")) == needle,
                func.lower(func.coalesce(Vm.business_owner, "")) == needle,
                func.lower(func.coalesce(Vm.technical_owner, "")) == needle,
            ))
        owner_match = or_(*owner_matches)
        stmt = stmt.where(~owner_match if owner_op == FilterOperator.neq else owner_match)
    if tag:
        tag_match = or_(*(Vm.tags.contains([t.strip()]) for t in tag))
        stmt = stmt.where(~tag_match if tag_op == FilterOperator.neq else tag_match)
    if application:
        app_matches = []
        for app in application:
            needle = app.strip().lower()
            app_matches.append(exists(select(VmApplication.vm_id).where(
                VmApplication.vm_id == Vm.id,
                func.lower(VmApplication.app_name).like(f"%{needle}%")
                if application_op == FilterOperator.contains
                else func.lower(VmApplication.app_name) == needle,
            )))
        app_match = or_(*app_matches)
        stmt = stmt.where(~app_match if application_op == FilterOperator.neq else app_match)
    if health == "below_50":
        stmt = stmt.where(Vm.health_score < 50)
    elif health == "below_75":
        stmt = stmt.where(Vm.health_score < 75)
    elif health == "complete":
        stmt = stmt.where(Vm.health_score >= 100)
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
