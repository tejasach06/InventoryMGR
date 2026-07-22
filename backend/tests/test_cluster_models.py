from app.core.security import hash_password
from app.db.models import PhysicalCluster, PhysicalNode, User, UserRole


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_cluster_cascades_to_nodes(db_session):
    u = _user(db_session)
    c = PhysicalCluster(name="pve-cluster-a", created_by_id=u.id, updated_by_id=u.id)
    db_session.add(c)
    db_session.flush()
    db_session.add(
        PhysicalNode(
            cluster_id=c.id,
            name="node-01",
            cpu_cores=16,
            cpu_threads=32,
            ram_total_gb=128,
            storage_usable_gb=2000,
            ip_addresses=[{"label": "mgmt", "address": "10.0.1.5"}],
        )
    )
    db_session.commit()
    db_session.delete(c)
    db_session.commit()
    assert db_session.query(PhysicalNode).count() == 0


def test_node_ip_addresses_default_empty_list(db_session):
    u = _user(db_session)
    c = PhysicalCluster(name="pve-cluster-b", created_by_id=u.id, updated_by_id=u.id)
    db_session.add(c)
    db_session.flush()
    n = PhysicalNode(cluster_id=c.id, name="node-01")
    db_session.add(n)
    db_session.commit()
    db_session.refresh(n)
    assert n.ip_addresses == []
    assert n.cpu_cores == 0 and n.cpu_threads == 0 and n.ram_total_gb == 0 and n.storage_usable_gb == 0