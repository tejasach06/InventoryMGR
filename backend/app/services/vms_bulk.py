from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User, Vm, VmApplication
from app.schemas.vms import VmBulkRequest, VmUpdate
from app.services.vm_filters import apply_vm_filters
from app.services.vm_mutations import update_vm

# A mis-set filter should not be able to rewrite the whole fleet in one request.
BULK_MAX = 1000


def _resolve_targets(db: Session, payload: VmBulkRequest) -> list[Vm]:
    if payload.ids is not None:
        stmt = select(Vm).where(Vm.id.in_(payload.ids))
    else:
        assert payload.filters is not None
        filters = payload.filters.model_dump()
        # apply_vm_filters names the status kwarg status_value, matching the
        # query dataclass alias.
        filters["status_value"] = filters.pop("status")
        stmt = apply_vm_filters(select(Vm), **filters)
    vms = list(db.scalars(stmt.order_by(Vm.name.asc())))
    if len(vms) > BULK_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{len(vms)} VMs matched; bulk edit is limited to {BULK_MAX}",
        )
    return vms


def _apply_applications(db: Session, vm: Vm, payload: VmBulkRequest) -> None:
    """Stage app removals/additions on `vm`; update_vm's commit persists them."""
    patch = payload.patch
    if not (patch.applications_add or patch.applications_remove):
        return
    removals = {name.lower() for name in patch.applications_remove}
    for app in [a for a in vm.applications if a.app_name.lower() in removals]:
        vm.applications.remove(app)  # delete-orphan cascade deletes the row
    # Unit of work inserts before deletes; flush so a remove+add of one name
    # cannot trip uq_vm_applications_vm_app.
    db.flush()
    present = {app.app_name.lower() for app in vm.applications}
    for name in patch.applications_add:
        if name.lower() not in present:
            present.add(name.lower())
            vm.applications.append(VmApplication(app_name=name))


def _patch_for(vm: Vm, payload: VmBulkRequest) -> VmUpdate:
    values = payload.patch.model_dump(
        exclude_unset=True,
        exclude={"tags_add", "tags_remove", "applications_add", "applications_remove"},
    )
    if payload.patch.tags_add or payload.patch.tags_remove:
        removals = {tag.lower() for tag in payload.patch.tags_remove}
        kept = [tag for tag in (vm.tags or []) if tag.lower() not in removals]
        existing = {tag.lower() for tag in kept}
        kept.extend(tag for tag in payload.patch.tags_add if tag.lower() not in existing)
        values["tags"] = kept
    return VmUpdate.model_validate(values)


def bulk_update_vms(db: Session, *, payload: VmBulkRequest, user: User) -> dict[str, Any]:
    """Apply one patch to many VMs, one `update_vm` call each.

    Partial success is deliberate: a single bad row must not waste a 900-VM
    operation, so failures are collected and reported per id.
    """
    updated = 0
    failed: list[dict[str, Any]] = []
    for vm in _resolve_targets(db, payload):
        try:
            _apply_applications(db, vm, payload)
            update_vm(db, vm, _patch_for(vm, payload), user)
            updated += 1
        except HTTPException as exc:
            db.rollback()
            failed.append({"id": vm.id, "message": str(exc.detail)})
    return {"updated": updated, "failed": failed}
