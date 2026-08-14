import uuid
from typing import Any, cast

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.services.vms import get_vm_or_404, recompute_health


def make_vm_subrouter[ReadSchema: BaseModel, CreateSchema: BaseModel, UpdateSchema: BaseModel](
    *,
    model: Any,
    create_schema: type[CreateSchema],
    update_schema: type[UpdateSchema],
    read_schema: type[ReadSchema],
    order_col: Any,
    not_found_detail: str,
    conflict_detail: str | None = None,
) -> APIRouter:
    """Factory for the list/add/update/delete pattern shared by disk, network, and application subrouters."""
    router = APIRouter()

    @router.get("", response_model=list[read_schema])  # type: ignore[valid-type]
    def list_items(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list:
        get_vm_or_404(db, vm_id)
        return list(db.scalars(select(model).where(model.vm_id == vm_id).order_by(order_col)))

    @router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    def add_item(vm_id: uuid.UUID, payload: create_schema,  # type: ignore[valid-type]
        db: DbSession, _: EditorUser, __: Csrf):
        get_vm_or_404(db, vm_id)
        item = model(vm_id=vm_id, **cast(BaseModel, payload).model_dump())
        db.add(item)
        if conflict_detail:
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict_detail)
        else:
            db.commit()
        db.refresh(item)
        recompute_health(db, vm_id)
        return item

    @router.patch("/{item_id}", response_model=read_schema)
    def update_item(
        vm_id: uuid.UUID,
        item_id: uuid.UUID,
        payload: update_schema,  # type: ignore[valid-type]
        db: DbSession,
        _: EditorUser,
        __: Csrf,
    ):
        item = db.scalar(select(model).where(model.id == item_id, model.vm_id == vm_id))
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        for key, value in cast(BaseModel, payload).model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        db.commit()
        db.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_item(
        vm_id: uuid.UUID, item_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
    ) -> None:
        item = db.scalar(select(model).where(model.id == item_id, model.vm_id == vm_id))
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        db.delete(item)
        db.commit()
        recompute_health(db, vm_id)

    return router
