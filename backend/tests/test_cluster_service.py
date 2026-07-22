from app.core.security import hash_password
from app.db.models import PhysicalCluster, PhysicalNode, User, UserRole
from app.schemas.clusters import PhysicalClusterCreate
from app.services import clusters


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_list_clusters_aggregates_nodes(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-a"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1", ram_total_gb=64, storage_usable_gb=1000))
    db_session.add(PhysicalNode(cluster_id=c.id, name="n2", ram_total_gb=128, storage_usable_gb=2000))
    db_session.commit()

    items = clusters.list_clusters(db_session)
    assert len(items) == 1
    assert items[0].node_count == 2
    assert items[0].total_ram_gb == 192
    assert items[0].total_storage_gb == 3000


def test_to_cluster_detail_includes_nodes(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-b"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1"))
    db_session.commit()

    detail = clusters.get_cluster_detail_or_404(db_session, c.id)
    out = clusters.to_cluster_detail(detail)
    assert out.name == "pve-b"
    assert len(out.nodes) == 1 and out.nodes[0].name == "n1"


def test_delete_cluster_cascades(db_session):
    u = _user(db_session)
    c = clusters.create_cluster(db_session, PhysicalClusterCreate(name="pve-c"), u)
    db_session.add(PhysicalNode(cluster_id=c.id, name="n1"))
    db_session.commit()
    clusters.delete_cluster(db_session, c)
    assert db_session.query(PhysicalNode).count() == 0