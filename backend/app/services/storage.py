import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import StorageArray, StorageVolume, User
from app.schemas.storage import (
    ArrayCreate,
    ArrayDetail,
    ArrayListItem,
    ArrayUpdate,
    LunRead,
    ShareRead,
    VolumeDetail,
)
from app.services import app_settings


def compute_pct(used: int, capacity: int) -> float | None:
    if not capacity:
        return None
    return round(used / capacity * 100, 1)


def _over(used: int, capacity: int, warn_pct: int) -> bool:
    pct = compute_pct(used, capacity)
    return pct is not None and pct >= warn_pct


_DETAIL_OPTIONS = [
    selectinload(StorageArray.volumes).selectinload(StorageVolume.luns),
    selectinload(StorageArray.volumes).selectinload(StorageVolume.shares),
]


def get_array_or_404(db: Session, array_id: uuid.UUID) -> StorageArray:
    array = db.get(StorageArray, array_id)
    if array is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage array not found")
    return array


def get_array_detail_or_404(db: Session, array_id: uuid.UUID) -> StorageArray:
    array = db.scalar(
        select(StorageArray).options(*_DETAIL_OPTIONS).where(StorageArray.id == array_id)
    )
    if array is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage array not found")
    return array


def create_array(db: Session, payload: ArrayCreate, user: User) -> StorageArray:
    array = StorageArray(**payload.model_dump(), created_by_id=user.id, updated_by_id=user.id)
    db.add(array)
    db.commit()
    db.refresh(array)
    return array


def update_array(
    db: Session, array: StorageArray, payload: ArrayUpdate, user: User
) -> StorageArray:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(array, key, value)
    array.updated_by_id = user.id
    db.commit()
    db.refresh(array)
    return array


def delete_array(db: Session, array: StorageArray) -> None:
    db.delete(array)
    db.commit()


def to_volume_detail(volume: StorageVolume, warn_pct: int) -> VolumeDetail:
    return VolumeDetail(
        **{c.name: getattr(volume, c.name) for c in StorageVolume.__table__.columns},
        luns=[LunRead.model_validate(lun) for lun in volume.luns],
        shares=[ShareRead.model_validate(share) for share in volume.shares],
        used_pct=compute_pct(volume.used_gb, volume.capacity_gb),
        over_threshold=_over(volume.used_gb, volume.capacity_gb, warn_pct),
    )


def to_array_detail(array: StorageArray, warn_pct: int) -> ArrayDetail:
    return ArrayDetail(
        **{c.name: getattr(array, c.name) for c in StorageArray.__table__.columns},
        used_pct=compute_pct(array.used_capacity_gb, array.total_capacity_gb),
        over_threshold=_over(array.used_capacity_gb, array.total_capacity_gb, warn_pct),
        volumes=[to_volume_detail(v, warn_pct) for v in array.volumes],
    )


def list_arrays(db: Session) -> list[ArrayListItem]:
    warn_pct = app_settings.get_warn_pct(db)
    arrays = db.scalars(select(StorageArray).options(*_DETAIL_OPTIONS)).all()
    items: list[ArrayListItem] = []
    for array in arrays:
        lun_count = sum(len(v.luns) for v in array.volumes)
        share_count = sum(len(v.shares) for v in array.volumes)
        items.append(
            ArrayListItem(
                id=array.id,
                name=array.name,
                vendor=array.vendor,
                datacenter=array.datacenter,
                total_capacity_gb=array.total_capacity_gb,
                used_capacity_gb=array.used_capacity_gb,
                used_pct=compute_pct(array.used_capacity_gb, array.total_capacity_gb),
                over_threshold=_over(array.used_capacity_gb, array.total_capacity_gb, warn_pct),
                volume_count=len(array.volumes),
                lun_count=lun_count,
                share_count=share_count,
            )
        )
    return items
