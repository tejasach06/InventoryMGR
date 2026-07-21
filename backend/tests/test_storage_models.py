from app.core.security import hash_password
from app.db.models import (
    DropdownCategory,
    StorageArray,
    StorageLun,
    StorageNfsShare,
    StorageVendor,
    StorageVolume,
    User,
    UserRole,
)


def _user(db):
    u = User(email="o@x.io", password_hash=hash_password("x"), role=UserRole.editor, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_cluster_is_a_dropdown_category():
    assert DropdownCategory.cluster.value == "cluster"


def test_array_cascades_to_children(db_session):
    u = _user(db_session)
    a = StorageArray(
        name="syn-01",
        vendor=StorageVendor.synology,
        total_capacity_gb=1000,
        used_capacity_gb=400,
        created_by_id=u.id,
        updated_by_id=u.id,
    )
    db_session.add(a)
    db_session.flush()
    v = StorageVolume(array_id=a.id, name="vol1", capacity_gb=500, used_gb=250)
    db_session.add(v)
    db_session.flush()
    db_session.add(StorageLun(volume_id=v.id, name="lun0", size_gb=100, cluster="pve-cluster-a"))
    db_session.add(StorageNfsShare(volume_id=v.id, export_path="/vol1/share"))
    db_session.commit()
    db_session.delete(a)
    db_session.commit()
    assert db_session.query(StorageVolume).count() == 0
    assert db_session.query(StorageLun).count() == 0
    assert db_session.query(StorageNfsShare).count() == 0
