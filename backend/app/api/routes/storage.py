import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

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


def make_storage_subrouter(
    *,
    child_segment: str,
    model: type,
    fk_attr: str,
    parent_model: type,
    create_schema: type[BaseModel],
    update_schema: type[BaseModel],
    read_schema: type[BaseModel],
    order_col: Any,
    not_found_detail: str,
    parent_not_found_detail: str,
) -> APIRouter:
    """List/add/patch/delete for a storage child, keyed on its parent id (no health recompute)."""
    router = APIRouter()

    def _require_parent(db: DbSession, parent_id: uuid.UUID) -> None:
        if db.get(parent_model, parent_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=parent_not_found_detail
            )

    @router.get(f"/{{parent_id}}/{child_segment}", response_model=list[read_schema])
    def list_items(parent_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list:
        _require_parent(db, parent_id)
        return list(
            db.scalars(
                select(model).where(getattr(model, fk_attr) == parent_id).order_by(order_col)
            )
        )

    @router.post(
        f"/{{parent_id}}/{child_segment}",
        response_model=read_schema,
        status_code=status.HTTP_201_CREATED,
    )
    def add_item(
        parent_id: uuid.UUID, payload: create_schema, db: DbSession, _: EditorUser, __: Csrf
    ):  # type: ignore[valid-type]
        _require_parent(db, parent_id)
        item = model(**{fk_attr: parent_id}, **payload.model_dump())
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    @router.patch(f"/{{parent_id}}/{child_segment}/{{item_id}}", response_model=read_schema)
    def update_item(
        parent_id: uuid.UUID,
        item_id: uuid.UUID,
        payload: update_schema,
        db: DbSession,
        _: EditorUser,
        __: Csrf,  # type: ignore[valid-type]
    ):
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        db.commit()
        db.refresh(item)
        return item

    @router.delete(
        f"/{{parent_id}}/{child_segment}/{{item_id}}", status_code=status.HTTP_204_NO_CONTENT
    )
    def delete_item(
        parent_id: uuid.UUID, item_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
    ) -> None:
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        db.delete(item)
        db.commit()

    return router


volumes_router = make_storage_subrouter(
    child_segment="volumes",
    model=StorageVolume,
    fk_attr="array_id",
    parent_model=StorageArray,
    create_schema=VolumeCreate,
    update_schema=VolumeUpdate,
    read_schema=VolumeRead,
    order_col=StorageVolume.sort_order,
    not_found_detail="Volume not found",
    parent_not_found_detail="Storage array not found",
)

luns_router = make_storage_subrouter(
    child_segment="luns",
    model=StorageLun,
    fk_attr="volume_id",
    parent_model=StorageVolume,
    create_schema=LunCreate,
    update_schema=LunUpdate,
    read_schema=LunRead,
    order_col=StorageLun.sort_order,
    not_found_detail="LUN not found",
    parent_not_found_detail="Volume not found",
)

shares_router = make_storage_subrouter(
    child_segment="shares",
    model=StorageNfsShare,
    fk_attr="volume_id",
    parent_model=StorageVolume,
    create_schema=ShareCreate,
    update_schema=ShareUpdate,
    read_schema=ShareRead,
    order_col=StorageNfsShare.sort_order,
    not_found_detail="NFS share not found",
    parent_not_found_detail="Volume not found",
)
