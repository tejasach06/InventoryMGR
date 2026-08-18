import uuid
from collections.abc import Callable
from typing import Any, cast

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser


def require_parent(parent_model: Any, detail: str) -> Callable[[Session, uuid.UUID], None]:
    """Parent-existence check for factories keyed on a plain FK."""

    def _check(db: Session, parent_id: uuid.UUID) -> None:
        if db.get(parent_model, parent_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)

    return _check


def make_child_router[ReadSchema: BaseModel, CreateSchema: BaseModel, UpdateSchema: BaseModel](
    *,
    model: Any,
    create_schema: type[CreateSchema],
    update_schema: type[UpdateSchema],
    read_schema: type[ReadSchema],
    order_col: Any,
    fk_attr: str,
    parent_check: Callable[[Session, uuid.UUID], None],
    not_found_detail: str,
    conflict_detail: str | None = None,
    stamp_user: bool = False,
    after_change: Callable[[Session, uuid.UUID], None] | None = None,
) -> APIRouter:
    """Unified factory for child-resource CRUD subrouters."""
    router = APIRouter()

    @router.get("", response_model=list[read_schema])  # type: ignore[valid-type]
    def list_items(parent_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list:
        parent_check(db, parent_id)
        return list(
            db.scalars(
                select(model).where(getattr(model, fk_attr) == parent_id).order_by(order_col)
            )
        )

    @router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    def add_item(
        parent_id: uuid.UUID,
        payload: create_schema,  # type: ignore[valid-type]
        db: DbSession,
        user: EditorUser,
        __: Csrf,
    ):
        parent_check(db, parent_id)
        item_kwargs: dict[str, Any] = {
            fk_attr: parent_id,
            **cast(BaseModel, payload).model_dump(),
        }
        if stamp_user:
            item_kwargs["created_by_id"] = user.id
            item_kwargs["updated_by_id"] = user.id
        item = model(**item_kwargs)
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
        if after_change:
            after_change(db, parent_id)
        return item

    @router.patch("/{item_id}", response_model=read_schema)
    def update_item(
        parent_id: uuid.UUID,
        item_id: uuid.UUID,
        payload: update_schema,  # type: ignore[valid-type]
        db: DbSession,
        user: EditorUser,
        __: Csrf,
    ):
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        for key, value in cast(BaseModel, payload).model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        if stamp_user:
            item.updated_by_id = user.id
        db.commit()
        db.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_item(
        parent_id: uuid.UUID,
        item_id: uuid.UUID,
        db: DbSession,
        _: EditorUser,
        __: Csrf,
    ) -> None:
        item = db.scalar(
            select(model).where(model.id == item_id, getattr(model, fk_attr) == parent_id)
        )
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
        db.delete(item)
        db.commit()
        if after_change:
            after_change(db, parent_id)

    return router
