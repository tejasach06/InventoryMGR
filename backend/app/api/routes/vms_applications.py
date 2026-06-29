import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import VmApplication
from app.schemas.vms import ApplicationCreate, ApplicationRead
from app.services.vms import get_vm_or_404, recompute_health

router = APIRouter()


@router.get("", response_model=list[ApplicationRead])
def list_applications(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list[VmApplication]:
    get_vm_or_404(db, vm_id)
    return list(db.scalars(select(VmApplication).where(VmApplication.vm_id == vm_id).order_by(VmApplication.app_name)))


@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def add_application(
    vm_id: uuid.UUID, payload: ApplicationCreate, db: DbSession, _: EditorUser, __: Csrf
) -> VmApplication:
    get_vm_or_404(db, vm_id)
    app = VmApplication(vm_id=vm_id, **payload.model_dump())
    db.add(app)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Application already linked to this VM")
    db.refresh(app)
    recompute_health(db, vm_id)
    return app


@router.patch("/{app_id}", response_model=ApplicationRead)
def update_application(
    vm_id: uuid.UUID,
    app_id: uuid.UUID,
    payload: ApplicationCreate,
    db: DbSession,
    _: EditorUser,
    __: Csrf,
) -> VmApplication:
    app = db.scalar(select(VmApplication).where(VmApplication.id == app_id, VmApplication.vm_id == vm_id))
    if app is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    for key, value in payload.model_dump().items():
        setattr(app, key, value)
    db.commit()
    db.refresh(app)
    return app


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_application(
    vm_id: uuid.UUID, app_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
) -> None:
    app = db.scalar(select(VmApplication).where(VmApplication.id == app_id, VmApplication.vm_id == vm_id))
    db.delete(app)
    db.commit()
    recompute_health(db, vm_id)
