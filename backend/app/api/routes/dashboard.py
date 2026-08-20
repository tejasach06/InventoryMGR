from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import case, func, select

from app.api.deps import DbSession, ViewerUser
from app.db.models import OsFamily, Vm, VmApplication, VmDisk, VmNetwork, VmStatus
from app.schemas.vms import DashboardAlertVm, DashboardStats
from app.services.vms import (
    decommission_overdue_condition,
    duplicate_ip_condition,
    missing_ip_condition,
    non_template_condition,
    shutdown_since_expr,
    shutdown_stale_condition,
)

router = APIRouter()

ALERT_LIST_LIMIT = 50


@router.get("", response_model=DashboardStats)
def get_dashboard(db: DbSession, _: ViewerUser) -> DashboardStats:
    vm_with_apps = select(VmApplication.vm_id).distinct().scalar_subquery()

    inventory_condition = non_template_condition()

    row = db.execute(
        select(
            func.count(Vm.id).label("total"),
            func.count(case((Vm.os_family == OsFamily.linux, 1))).label("linux"),
            func.count(case((Vm.os_family == OsFamily.windows, 1))).label("windows"),
            func.count(case((Vm.environment == "production", 1))).label("production"),
            func.count(case((Vm.environment == "development", 1))).label("development"),
            func.count(case((Vm.environment.in_(["testing", "uat"]), 1))).label("test_uat"),
            func.count(case((Vm.status == "powered_off", 1))).label("powered_off"),
            func.count(case((Vm.monitoring_enabled == False, 1))).label("without_monitoring"),  # noqa: E712
            func.count(case((Vm.id.not_in(vm_with_apps), 1))).label("without_applications"),
            func.coalesce(func.sum(Vm.cpu_cores), 0).label("total_vcpu"),
            func.coalesce(func.sum(Vm.memory_mb), 0).label("total_memory_mb"),
        ).where(inventory_condition)
    ).one()

    total_disk_gb = (
        db.scalar(
            select(func.coalesce(func.sum(VmDisk.size_gb), 0)).join(Vm).where(inventory_condition)
        )
        or 0
    )

    status_rows = db.execute(
        select(Vm.status, func.count(Vm.id)).where(inventory_condition).group_by(Vm.status)
    ).all()
    by_status = {
        str(k.value if hasattr(k, "value") else k): cnt for k, cnt in status_rows if k is not None
    }

    env_rows = db.execute(
        select(Vm.environment, func.count(Vm.id))
        .where(inventory_condition)
        .group_by(Vm.environment)
    ).all()
    by_environment = {
        str(k.value if hasattr(k, "value") else k): cnt for k, cnt in env_rows if k is not None
    }

    crit_rows = db.execute(
        select(Vm.criticality, func.count(Vm.id))
        .where(inventory_condition)
        .group_by(Vm.criticality)
    ).all()
    by_criticality = {
        str(k.value if hasattr(k, "value") else k): cnt for k, cnt in crit_rows if k is not None
    }

    os_rows = db.execute(
        select(Vm.os_family, func.count(Vm.id)).where(inventory_condition).group_by(Vm.os_family)
    ).all()
    by_os_family = {
        str(k.value if hasattr(k, "value") else k): cnt for k, cnt in os_rows if k is not None
    }

    now = datetime.now(UTC)
    today = now.date()

    # List 1: Powered off > 90 days
    since = shutdown_since_expr()
    status_cond, age_cond = shutdown_stale_condition()
    rows1 = db.execute(
        select(Vm, since.label("since"))
        .where(status_cond, age_cond, inventory_condition)
        .order_by(since.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    shutdown_stale: list[DashboardAlertVm] = []
    for vm, vm_since in rows1:
        # Handle naive or aware datetime comparison for Python side
        since_dt = vm_since if vm_since.tzinfo else vm_since.replace(tzinfo=UTC)
        days = (now - since_dt).days
        shutdown_stale.append(
            DashboardAlertVm(
                id=vm.id,
                name=vm.name,
                environment=vm.environment,
                days=days,
            )
        )

    # List 2: Past decommission date
    overdue_vms = db.scalars(
        select(Vm)
        .where(decommission_overdue_condition(), inventory_condition)
        .order_by(Vm.decommission_date.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    decommission_overdue = []
    for vm in overdue_vms:
        if vm.decommission_date is not None:
            decommission_overdue.append(
                DashboardAlertVm(
                    id=vm.id,
                    name=vm.name,
                    environment=vm.environment,
                    days=(today - vm.decommission_date).days,
                )
            )

    # List 3: Missing IP address
    no_ip_vms = db.scalars(
        select(Vm)
        .where(missing_ip_condition(), inventory_condition)
        .order_by(Vm.name.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    missing_ip: list[DashboardAlertVm] = []
    for vm in no_ip_vms:
        missing_ip.append(
            DashboardAlertVm(
                id=vm.id,
                name=vm.name,
                environment=vm.environment,
                days=0,
            )
        )

    # List 4: Duplicate IP address
    dup_ip_vms = db.scalars(
        select(Vm)
        .where(duplicate_ip_condition(), inventory_condition)
        .order_by(Vm.name.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    duplicate_ip: list[DashboardAlertVm] = []
    for vm in dup_ip_vms:
        # Find first conflicting address (lowest sort_order VmNetwork matching duplicate rule)
        conflicting_ip: str | None = None
        for net in sorted(vm.networks, key=lambda n: (n.sort_order, str(n.id))):
            other_count = db.scalar(
                select(func.count(VmNetwork.id))
                .join(Vm, VmNetwork.vm_id == Vm.id)
                .where(
                    VmNetwork.ip_address == net.ip_address,
                    VmNetwork.role == net.role,
                    VmNetwork.vm_id != vm.id,
                    Vm.status != VmStatus.decommissioned,
                    inventory_condition,
                )
            )
            if other_count and other_count > 0:
                conflicting_ip = net.ip_address
                break
        duplicate_ip.append(
            DashboardAlertVm(
                id=vm.id,
                name=vm.name,
                environment=vm.environment,
                days=0,
                detail=conflicting_ip,
            )
        )

    return DashboardStats(
        total=row.total,
        linux=row.linux,
        windows=row.windows,
        production=row.production,
        development=row.development,
        test_uat=row.test_uat,
        powered_off=row.powered_off,
        without_monitoring=row.without_monitoring,
        without_applications=row.without_applications,
        total_vcpu=int(row.total_vcpu),
        total_memory_gb=float(row.total_memory_mb) / 1024.0,
        total_disk_gb=float(total_disk_gb),
        by_status=by_status,
        by_environment=by_environment,
        by_criticality=by_criticality,
        by_os_family=by_os_family,
        shutdown_stale=shutdown_stale,
        decommission_overdue=decommission_overdue,
        missing_ip=missing_ip,
        duplicate_ip=duplicate_ip,
    )
