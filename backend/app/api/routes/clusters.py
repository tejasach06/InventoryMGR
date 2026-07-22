import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import PhysicalCluster, PhysicalNode
from app.schemas.clusters import (
    PhysicalClusterCreate,
    PhysicalClusterDetail,
    PhysicalClusterListItem,
    PhysicalClusterUpdate,
    PhysicalNodeCreate,
    PhysicalNodeRead,
    PhysicalNodeUpdate,
)
from app.services import clusters

router = APIRouter()


@router.get("/", response_model=list[PhysicalClusterListItem])
def list_clusters(db: DbSession, _: ViewerUser) -> list[PhysicalClusterListItem]:
    return clusters.list_clusters(db)


@router.post("/", response_model=PhysicalClusterDetail, status_code=status.HTTP_201_CREATED)
def create_cluster(
    payload: PhysicalClusterCreate, db: DbSession, user: EditorUser, __: Csrf
) -> PhysicalClusterDetail:
    cluster = clusters.create_cluster(db, payload, user)
    detail = clusters.get_cluster_detail_or_404(db, cluster.id)
    return clusters.to_cluster_detail(detail)


@router.get("/{cluster_id}", response_model=PhysicalClusterDetail)
def get_cluster(cluster_id: uuid.UUID, db: DbSession, _: ViewerUser) -> PhysicalClusterDetail:
    cluster = clusters.get_cluster_detail_or_404(db, cluster_id)
    return clusters.to_cluster_detail(cluster)


@router.patch("/{cluster_id}", response_model=PhysicalClusterDetail)
def update_cluster(
    cluster_id: uuid.UUID, payload: PhysicalClusterUpdate, db: DbSession, user: EditorUser, __: Csrf
) -> PhysicalClusterDetail:
    cluster = clusters.get_cluster_or_404(db, cluster_id)
    clusters.update_cluster(db, cluster, payload, user)
    detail = clusters.get_cluster_detail_or_404(db, cluster_id)
    return clusters.to_cluster_detail(detail)


@router.delete("/{cluster_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cluster(cluster_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf) -> None:
    cluster = clusters.get_cluster_or_404(db, cluster_id)
    clusters.delete_cluster(db, cluster)


def make_cluster_subrouter(
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
    """List/add/patch/delete for a cluster child, keyed on its parent id."""
    router = APIRouter()

    def _require_parent(db: DbSession, parent_id: uuid.UUID) -> None:
        if db.get(parent_model, parent_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=parent_not_found_detail
            )

    @router.get(f"/{{parent_id}}/{child_segment}/", response_model=list[read_schema])
    def list_items(parent_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list:
        _require_parent(db, parent_id)
        return list(
            db.scalars(
                select(model).where(getattr(model, fk_attr) == parent_id).order_by(order_col)
            )
        )

    @router.post(
        f"/{{parent_id}}/{child_segment}/",
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


nodes_router = make_cluster_subrouter(
    child_segment="nodes",
    model=PhysicalNode,
    fk_attr="cluster_id",
    parent_model=PhysicalCluster,
    create_schema=PhysicalNodeCreate,
    update_schema=PhysicalNodeUpdate,
    read_schema=PhysicalNodeRead,
    order_col=PhysicalNode.sort_order,
    not_found_detail="Node not found",
    parent_not_found_detail="Cluster not found",
)