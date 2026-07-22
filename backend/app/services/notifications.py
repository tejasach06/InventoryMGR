import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DecommissionAck, Lifecycle, Vm, VmStatus
from app.schemas.notifications import DueVmRead
from app.services.app_settings import get_notify_days


def _due_vms(db: Session, cutoff: date) -> list[Vm]:
    stmt = (
        select(Vm)
        .where(Vm.decommission_date.is_not(None))
        .where(Vm.decommission_date <= cutoff)
        .where(Vm.lifecycle != Lifecycle.retired)
        .where(Vm.status != VmStatus.decommissioned)
        .order_by(Vm.decommission_date.asc())
    )
    return list(db.scalars(stmt).all())


def list_due(db: Session, user_id: uuid.UUID) -> list[DueVmRead]:
    today = date.today()
    cutoff = today + timedelta(days=get_notify_days(db))
    vms = _due_vms(db, cutoff)
    acks = {
        a.vm_id: a.acked_date
        for a in db.scalars(select(DecommissionAck).where(DecommissionAck.user_id == user_id)).all()
    }
    return [
        DueVmRead(
            vm_id=vm.id,
            name=vm.name,
            decommission_date=vm.decommission_date,
            days_remaining=(vm.decommission_date - today).days,
            unread=acks.get(vm.id) != vm.decommission_date,
        )
        for vm in vms
    ]


def ack(db: Session, user_id: uuid.UUID, vm_ids: list[uuid.UUID] | None) -> None:
    today = date.today()
    cutoff = today + timedelta(days=get_notify_days(db))
    targets = {vm.id: vm.decommission_date for vm in _due_vms(db, cutoff)}
    selected = targets if vm_ids is None else {i: targets[i] for i in vm_ids if i in targets}
    existing = {
        a.vm_id: a
        for a in db.scalars(select(DecommissionAck).where(DecommissionAck.user_id == user_id)).all()
    }
    for vm_id, dec_date in selected.items():
        if vm_id in existing:
            existing[vm_id].acked_date = dec_date
        else:
            db.add(DecommissionAck(user_id=user_id, vm_id=vm_id, acked_date=dec_date))
    db.commit()
