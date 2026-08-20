import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import DecommissionAck, Vm, VmNetwork, VmStatus
from app.schemas.notifications import DueVmRead, DuplicateIpRead, DuplicateIpVm
from app.services.app_settings import get_notify_days
from app.services.vm_filters import non_template_condition


def _due_vms(db: Session, cutoff: date) -> list[Vm]:
    stmt = (
        select(Vm)
        .where(Vm.decommission_date.is_not(None))
        .where(Vm.decommission_date <= cutoff)
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
    result: list[DueVmRead] = []
    for vm in vms:
        if vm.decommission_date is None:
            continue
        result.append(
            DueVmRead(
                vm_id=vm.id,
                name=vm.name,
                decommission_date=vm.decommission_date,
                days_remaining=(vm.decommission_date - today).days,
                unread=acks.get(vm.id) != vm.decommission_date,
            )
        )
    return result


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
        if dec_date is None:
            continue
        if vm_id in existing:
            existing[vm_id].acked_date = dec_date
        else:
            db.add(DecommissionAck(user_id=user_id, vm_id=vm_id, acked_date=dec_date))
    db.commit()

def list_duplicate_ips(db: Session) -> list[DuplicateIpRead]:
    """Find active, non-template VMs that share the same IP address and role."""
    inventory_cond = non_template_condition()
    # Find (ip_address, role) pairs with > 1 distinct active, non-template VMs
    dup_keys_stmt = (
        select(VmNetwork.ip_address)
        .join(Vm, VmNetwork.vm_id == Vm.id)
        .where(Vm.status == VmStatus.running, inventory_cond)
        .group_by(VmNetwork.ip_address)
        .having(func.count(VmNetwork.id) > 1)
        .order_by(VmNetwork.ip_address.asc())
    )
    dup_keys = db.execute(dup_keys_stmt).all()
    if not dup_keys:
        return []

    result: list[DuplicateIpRead] = []
    for ip_addr in db.execute(dup_keys_stmt).scalars():
        occurrences = db.scalar(
            select(func.count(VmNetwork.id))
            .join(Vm, VmNetwork.vm_id == Vm.id)
            .where(VmNetwork.ip_address == ip_addr, Vm.status == VmStatus.running, inventory_cond)
        )
        vm_rows = (
            db.execute(
                select(Vm.id, Vm.name)
                .join(VmNetwork, VmNetwork.vm_id == Vm.id)
                .where(VmNetwork.ip_address == ip_addr, Vm.status == VmStatus.running, inventory_cond)
                .distinct()
                .order_by(Vm.name.asc())
            )
            .all()
        )
        result.append(
            DuplicateIpRead(
                ip_address=ip_addr,
                occurrences=occurrences or 0,
                vms=[DuplicateIpVm(vm_id=r[0], name=r[1]) for r in vm_rows],
            )
        )
    return result
