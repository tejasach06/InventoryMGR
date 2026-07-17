from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import case, func, select  # func used for count

from app.api.deps import DbSession, ViewerUser
from app.db.models import OsFamily, Vm, VmApplication
from app.schemas.vms import DashboardStats, DashboardVmSummary

router = APIRouter()


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

    cutoff = datetime.now(UTC) - timedelta(days=30)
    recent = list(db.scalars(
        select(Vm).where(Vm.created_at >= cutoff).order_by(Vm.created_at.desc()).limit(10)
    ))

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
        recently_added=[DashboardVmSummary.model_validate(vm) for vm in recent],
    )
