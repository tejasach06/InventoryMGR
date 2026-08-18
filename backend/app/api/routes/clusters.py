import uuid

from fastapi import APIRouter, status

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

from ._child_crud import make_child_router, require_parent

router = APIRouter()


@router.get("", response_model=list[PhysicalClusterListItem])
def list_clusters(db: DbSession, _: ViewerUser) -> list[PhysicalClusterListItem]:
    return clusters.list_clusters(db)


@router.post("", response_model=PhysicalClusterDetail, status_code=status.HTTP_201_CREATED)
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


nodes_router = make_child_router(
    model=PhysicalNode,
    create_schema=PhysicalNodeCreate,
    update_schema=PhysicalNodeUpdate,
    read_schema=PhysicalNodeRead,
    order_col=PhysicalNode.sort_order,
    fk_attr="cluster_id",
    parent_check=require_parent(PhysicalCluster, "Cluster not found"),
    not_found_detail="Node not found",
    stamp_user=True,
)
