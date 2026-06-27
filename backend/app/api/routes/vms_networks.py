import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import Csrf, DbSession, EditorUser, ViewerUser
from app.db.models import VmNetwork
from app.schemas.vms import NetworkCreate, NetworkRead
from app.services.vms import get_vm_or_404

router = APIRouter()


@router.get("", response_model=list[NetworkRead])
def list_networks(vm_id: uuid.UUID, db: DbSession, _: ViewerUser) -> list[VmNetwork]:
    get_vm_or_404(db, vm_id)
    return list(db.scalars(select(VmNetwork).where(VmNetwork.vm_id == vm_id).order_by(VmNetwork.sort_order)))


@router.post("", response_model=NetworkRead, status_code=status.HTTP_201_CREATED)
def add_network(
    vm_id: uuid.UUID, payload: NetworkCreate, db: DbSession, _: EditorUser, __: Csrf
) -> VmNetwork:
    get_vm_or_404(db, vm_id)
    net = VmNetwork(vm_id=vm_id, **payload.model_dump())
    db.add(net)
    db.commit()
    db.refresh(net)
    return net


@router.patch("/{network_id}", response_model=NetworkRead)
def update_network(
    vm_id: uuid.UUID,
    network_id: uuid.UUID,
    payload: NetworkCreate,
    db: DbSession,
    _: EditorUser,
    __: Csrf,
) -> VmNetwork:
    net = db.scalar(select(VmNetwork).where(VmNetwork.id == network_id, VmNetwork.vm_id == vm_id))
    if net is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network entry not found")
    for key, value in payload.model_dump().items():
        setattr(net, key, value)
    db.commit()
    db.refresh(net)
    return net


@router.delete("/{network_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_network(
    vm_id: uuid.UUID, network_id: uuid.UUID, db: DbSession, _: EditorUser, __: Csrf
) -> None:
    net = db.scalar(select(VmNetwork).where(VmNetwork.id == network_id, VmNetwork.vm_id == vm_id))
    if net is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Network entry not found")
    db.delete(net)
    db.commit()
