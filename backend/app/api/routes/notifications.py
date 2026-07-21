from fastapi import APIRouter, status

from app.api.deps import Csrf, DbSession, ViewerUser
from app.schemas.notifications import AckRequest, DueVmRead
from app.services import notifications

router = APIRouter()


@router.get("/decommissions", response_model=list[DueVmRead])
def list_decommissions(db: DbSession, user: ViewerUser) -> list[DueVmRead]:
    return notifications.list_due(db, user.id)


@router.post("/decommissions/ack", status_code=status.HTTP_204_NO_CONTENT)
def ack_decommissions(payload: AckRequest, db: DbSession, user: ViewerUser, __: Csrf) -> None:
    notifications.ack(db, user.id, payload.vm_ids)
