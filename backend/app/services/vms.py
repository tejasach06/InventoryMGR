import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, String, and_, case, cast, exists, func, literal_column, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLog,
    Criticality,
    Environment,
    NetworkRole,
    OsFamily,
    Platform,
    User,
    Vm,
    VmApplication,
    VmDisk,
    VmNetwork,
    VmStatus,
    compute_health_score,
)
from app.schemas.vms import VmRead
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
    "missing_ip_condition",
    "non_template_condition",
    "recompute_health",
    "shutdown_since_expr",
    "shutdown_stale_condition",
    "template_tag_condition",
    "to_vm_read",
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


SHUTDOWN_STALE_DAYS = 90




def template_tag_condition():
    path = cast('$[*] ? (@ like_regex "^template$" flag "i")', JSONPATH)
    return func.jsonb_path_exists(Vm.tags, path)


def non_template_condition():
    return ~template_tag_condition()

def shutdown_since_expr():
    """Latest moment a VM entered powered_off, falling back to creation."""
    last_off_time = (
        select(func.max(AuditLog.changed_at))
        .where(
            AuditLog.vm_id == Vm.id,
            # Literals, not binds: the partial index on audit_log is only
            # matched by the planner when these appear as constants.
            AuditLog.field_name == literal_column("'status'"),
            AuditLog.new_value == literal_column("'powered_off'"),
        )
        .scalar_subquery()
    )
    return func.coalesce(last_off_time, Vm.created_at)


def shutdown_stale_condition():
    """VM is powered_off and has been for at least SHUTDOWN_STALE_DAYS."""
    since = shutdown_since_expr()
    cutoff = datetime.now(UTC) - timedelta(days=SHUTDOWN_STALE_DAYS)
    return Vm.status == VmStatus.powered_off, since <= cutoff


def decommission_overdue_condition():
    """decommission_date has arrived or passed, but the VM is not decommissioned."""
    today = datetime.now(UTC).date()
    return and_(
        Vm.decommission_date.is_not(None),
        Vm.decommission_date <= today,
        Vm.status != VmStatus.decommissioned,
    )


def missing_ip_condition():
    """VM has zero vm_networks rows. NOT EXISTS, mirroring the ip_role filter."""
    return ~exists(select(VmNetwork.vm_id).where(VmNetwork.vm_id == Vm.id))


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
    ip_role: list[NetworkRole] | None = None,
    health: str | None = None,
    shutdown_stale: bool | None = None,
    decommission_overdue: bool | None = None,
    missing_ip: bool | None = None,
) -> Select[tuple[Vm]]:
    if ip_role:
        # EXISTS, not a join: a VM with several IPs in the role must appear once.
        stmt = stmt.where(
            exists(
                select(VmNetwork.vm_id).where(
                    VmNetwork.vm_id == Vm.id,
                    VmNetwork.role.in_(ip_role),
                )
            )
        )
    if q:
        pattern = f"%{q.strip().lower()}%"
        net_subq = exists(
            select(VmNetwork.vm_id).where(
                VmNetwork.vm_id == Vm.id,
                func.lower(VmNetwork.ip_address).like(pattern),
            )
        )
        app_subq = exists(
            select(VmApplication.vm_id).where(
                VmApplication.vm_id == Vm.id,
                func.lower(VmApplication.app_name).like(pattern),
            )
        )
        stmt = stmt.where(
            or_(
                func.lower(Vm.name).like(pattern),
                func.lower(Vm.cluster).like(pattern),
                func.lower(func.coalesce(Vm.owner, "")).like(pattern),
                func.lower(func.coalesce(Vm.fqdn, "")).like(pattern),
                func.lower(func.coalesce(Vm.external_id, "")).like(pattern),
                func.lower(func.coalesce(Vm.sr_id, "")).like(pattern),
                func.lower(func.coalesce(Vm.os_distribution, "")).like(pattern),
                func.lower(func.coalesce(Vm.os_version, "")).like(pattern),
                # ponytail: imprecise JSONB cast, fine for search
                cast(Vm.tags, String).like(f"%{q.strip()}%"),
                net_subq,
                app_subq,
            )
        )
    FILTER_SPECS = ((pmp_enabled, Vm.pmp_enabled, pmp_enabled_op, False),)
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
            owner_matches.append(
                or_(
                    func.lower(func.coalesce(Vm.owner, "")) == needle,
                    func.lower(func.coalesce(Vm.business_owner, "")) == needle,
                    func.lower(func.coalesce(Vm.technical_owner, "")) == needle,
                )
            )
        owner_match = or_(*owner_matches)
        stmt = stmt.where(~owner_match if owner_op == FilterOperator.neq else owner_match)
    if tag:
        tag_match = or_(*(Vm.tags.contains([t.strip()]) for t in tag))
        stmt = stmt.where(~tag_match if tag_op == FilterOperator.neq else tag_match)
    if application:
        app_matches = []
        for app in application:
            needle = app.strip().lower()
            app_matches.append(
                exists(
                    select(VmApplication.vm_id).where(
                        VmApplication.vm_id == Vm.id,
                        func.lower(VmApplication.app_name).like(f"%{needle}%")
                        if application_op == FilterOperator.contains
                        else func.lower(VmApplication.app_name) == needle,
                    )
                )
            )
        app_match = or_(*app_matches)
        stmt = stmt.where(~app_match if application_op == FilterOperator.neq else app_match)
    if health == "below_50":
        stmt = stmt.where(Vm.health_score < 50, non_template_condition())
    elif health == "below_75":
        stmt = stmt.where(Vm.health_score < 75, non_template_condition())
    elif health == "complete":
        stmt = stmt.where(Vm.health_score >= 100, non_template_condition())
    if shutdown_stale is not None:
        status_cond, age_cond = shutdown_stale_condition()
        match = and_(status_cond, age_cond)
        stmt = stmt.where(match if shutdown_stale else ~match)
    if decommission_overdue is not None:
        match = decommission_overdue_condition()
        stmt = stmt.where(match if decommission_overdue else ~match)
    if missing_ip is not None:
        match = missing_ip_condition()
        stmt = stmt.where(match if missing_ip else ~match)
    return stmt


# Enum columns sort by meaning, not by spelling: alphabetically `critical` would
# land between `high` and `medium`, which reads as a broken sort.
_CRITICALITY_ORDER = case(
    {
        Criticality.critical: 0,
        Criticality.high: 1,
        Criticality.medium: 2,
        Criticality.low: 3,
    },
    value=Vm.criticality,
)
_STATUS_ORDER = case(
    {
        VmStatus.running: 0,
        VmStatus.powered_off: 1,
        VmStatus.unknown: 2,
        VmStatus.decommissioned: 3,
    },
    value=Vm.status,
)

# The single source of truth for sortable keys: the route pattern and the
# frontend column whitelist both derive from it, so they cannot drift.
SORT_COLUMNS: dict[str, Any] = {
    "name": Vm.name,
    "status": _STATUS_ORDER,
    "criticality": _CRITICALITY_ORDER,
    "health": Vm.health_score,
    "updated_at": Vm.updated_at,
    "cluster": Vm.cluster,
    "platform": Vm.platform,
    "environment": Vm.environment,
    "cpu_cores": Vm.cpu_cores,
    "memory_mb": Vm.memory_mb,
    "owner": Vm.owner,
}
SORT_PATTERN = "^(" + "|".join(SORT_COLUMNS) + ")$"


def list_vms(
    db: Session,
    filters: dict[str, Any],
    limit: int,
    offset: int,
    sort: str | None = None,
    direction: str = "asc",
) -> tuple[list[Vm], int]:
    base = apply_vm_filters(select(Vm), **filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    if sort is None:
        ordering = [Vm.updated_at.desc()]
    else:
        column = SORT_COLUMNS[sort]
        ordering = [column.desc() if direction == "desc" else column.asc()]
    items = db.scalars(
        base.options(
            selectinload(Vm.disks),
            selectinload(Vm.networks),
            selectinload(Vm.applications),
        )
        # Vm.name is the final tie-break on every ordering. Without a total order
        # Postgres may repeat or skip rows between pages.
        .order_by(*ordering, Vm.name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return list(items), total
