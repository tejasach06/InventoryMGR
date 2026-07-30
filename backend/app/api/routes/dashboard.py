from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import case, func, select

from app.api.deps import DbSession, ViewerUser
from app.db.models import OsFamily, Vm, VmApplication, VmStatus
from app.schemas.vms import DashboardAlertVm, DashboardStats
from app.services.vms import (
    SHUTDOWN_STALE_DAYS,
    decommission_overdue_condition,
    missing_ip_condition,
    shutdown_since_expr,
    shutdown_stale_condition,
)

router = APIRouter()

ALERT_LIST_LIMIT = 50
EXCLUDED_TAGS = {"template", "backup"}


@router.get("", response_model=DashboardStats)
def get_dashboard(db: DbSession, _: ViewerUser) -> DashboardStats:
    vm_with_apps = select(VmApplication.vm_id).distinct().scalar_subquery()

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
        )
    ).one()

    now = datetime.now(UTC)
    today = now.date()

    # List 1: Powered off > 90 days
    since = shutdown_since_expr()
    status_cond, age_cond = shutdown_stale_condition()
    rows1 = db.execute(
        select(Vm, since.label("since"))
        .where(status_cond, age_cond)
        .order_by(since.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    shutdown_stale: list[DashboardAlertVm] = []
    for vm, vm_since in rows1:
        tags = {t.strip().lower() for t in (vm.tags or [])}
        if tags & EXCLUDED_TAGS:
            continue
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
        .where(decommission_overdue_condition())
        .order_by(Vm.decommission_date.asc())
        .limit(ALERT_LIST_LIMIT)
    ).all()
    decommission_overdue = [
        DashboardAlertVm(
            id=vm.id,
            name=vm.name,
            environment=vm.environment,
            days=(today - vm.decommission_date).days,
        )
        for vm in overdue_vms
    ]

    # List 3: Missing IP address
    no_ip_vms = db.scalars(
        select(Vm).where(missing_ip_condition()).order_by(Vm.name.asc()).limit(ALERT_LIST_LIMIT)
    ).all()
    missing_ip: list[DashboardAlertVm] = []
    for vm in no_ip_vms:
        tags = {t.strip().lower() for t in (vm.tags or [])}
        if tags & EXCLUDED_TAGS:
            continue
        missing_ip.append(
            DashboardAlertVm(
                id=vm.id,
                name=vm.name,
                environment=vm.environment,
                days=0,
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
        shutdown_stale=shutdown_stale,
        decommission_overdue=decommission_overdue,
        missing_ip=missing_ip,
    )
