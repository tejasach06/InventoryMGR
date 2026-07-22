import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import PhysicalCluster, PhysicalNode, User
from app.schemas.clusters import (
    PhysicalClusterCreate,
    PhysicalClusterDetail,
    PhysicalClusterListItem,
    PhysicalClusterUpdate,
    PhysicalNodeRead,
)

_NODES_OPTION = selectinload(PhysicalCluster.nodes)


def get_cluster_or_404(db: Session, cluster_id: uuid.UUID) -> PhysicalCluster:
    cluster = db.get(PhysicalCluster, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")
    return cluster


def get_cluster_detail_or_404(db: Session, cluster_id: uuid.UUID) -> PhysicalCluster:
    cluster = db.scalar(
        select(PhysicalCluster).options(_NODES_OPTION).where(PhysicalCluster.id == cluster_id)
    )
    if cluster is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")
    return cluster


def create_cluster(db: Session, payload: PhysicalClusterCreate, user: User) -> PhysicalCluster:
    cluster = PhysicalCluster(**payload.model_dump(), created_by_id=user.id, updated_by_id=user.id)
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    return cluster


def update_cluster(
    db: Session, cluster: PhysicalCluster, payload: PhysicalClusterUpdate, user: User
) -> PhysicalCluster:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(cluster, key, value)
    cluster.updated_by_id = user.id
    db.commit()
    db.refresh(cluster)
    return cluster


def delete_cluster(db: Session, cluster: PhysicalCluster) -> None:
    db.delete(cluster)
    db.commit()


def to_cluster_detail(cluster: PhysicalCluster) -> PhysicalClusterDetail:
    return PhysicalClusterDetail(
        id=cluster.id,
        name=cluster.name,
        description=cluster.description,
        notes=cluster.notes,
        nodes=[PhysicalNodeRead.model_validate(n) for n in cluster.nodes],
        created_at=cluster.created_at,
        updated_at=cluster.updated_at,
    )


def list_clusters(db: Session) -> list[PhysicalClusterListItem]:
    all_clusters = db.scalars(select(PhysicalCluster).options(_NODES_OPTION)).all()
    items: list[PhysicalClusterListItem] = []
    for cluster in all_clusters:
        nodes: list[PhysicalNode] = cluster.nodes
        items.append(
            PhysicalClusterListItem(
                id=cluster.id,
                name=cluster.name,
                description=cluster.description,
                node_count=len(nodes),
                total_ram_gb=sum(n.ram_total_gb for n in nodes),
                total_storage_gb=sum(n.storage_usable_gb for n in nodes),
            )
        )
    return items
