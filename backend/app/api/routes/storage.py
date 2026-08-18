import uuid

from fastapi import APIRouter, status

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import StorageArray, StorageLun, StorageNfsShare, StorageVolume
from app.schemas.storage import (
    ArrayCreate,
    ArrayDetail,
    ArrayListItem,
    ArrayUpdate,
    LunCreate,
    LunRead,
    LunUpdate,
    ShareCreate,
    ShareRead,
    ShareUpdate,
    VolumeCreate,
    VolumeRead,
    VolumeUpdate,
)
from app.services import app_settings, storage

from ._child_crud import make_child_router, require_parent

router = APIRouter()


@router.get("/arrays", response_model=list[ArrayListItem])
def list_arrays(db: DbSession, _: ViewerUser) -> list[ArrayListItem]:
    return storage.list_arrays(db)


@router.post("/arrays", response_model=ArrayDetail, status_code=status.HTTP_201_CREATED)
def create_array(payload: ArrayCreate, db: DbSession, user: EditorUser, __: Csrf) -> ArrayDetail:
    array = storage.create_array(db, payload, user)
    detail = storage.get_array_detail_or_404(db, array.id)
    return storage.to_array_detail(detail, app_settings.get_warn_pct(db))


@router.get("/arrays/{array_id}", response_model=ArrayDetail)
def get_array(array_id: uuid.UUID, db: DbSession, _: ViewerUser) -> ArrayDetail:
    array = storage.get_array_detail_or_404(db, array_id)
    return storage.to_array_detail(array, app_settings.get_warn_pct(db))


@router.patch("/arrays/{array_id}", response_model=ArrayDetail)
def update_array(
    array_id: uuid.UUID, payload: ArrayUpdate, db: DbSession, user: EditorUser, __: Csrf
) -> ArrayDetail:
    array = storage.get_array_or_404(db, array_id)
    storage.update_array(db, array, payload, user)
    detail = storage.get_array_detail_or_404(db, array_id)
    return storage.to_array_detail(detail, app_settings.get_warn_pct(db))


@router.delete("/arrays/{array_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_array(array_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf) -> None:
    array = storage.get_array_or_404(db, array_id)
    storage.delete_array(db, array)


volumes_router = make_child_router(
    model=StorageVolume,
    create_schema=VolumeCreate,
    update_schema=VolumeUpdate,
    read_schema=VolumeRead,
    order_col=StorageVolume.sort_order,
    fk_attr="array_id",
    parent_check=require_parent(StorageArray, "Storage array not found"),
    not_found_detail="Volume not found",
)

luns_router = make_child_router(
    model=StorageLun,
    create_schema=LunCreate,
    update_schema=LunUpdate,
    read_schema=LunRead,
    order_col=StorageLun.sort_order,
    fk_attr="volume_id",
    parent_check=require_parent(StorageVolume, "Volume not found"),
    not_found_detail="LUN not found",
)

shares_router = make_child_router(
    model=StorageNfsShare,
    create_schema=ShareCreate,
    update_schema=ShareUpdate,
    read_schema=ShareRead,
    order_col=StorageNfsShare.sort_order,
    fk_attr="volume_id",
    parent_check=require_parent(StorageVolume, "Volume not found"),
    not_found_detail="NFS share not found",
)
