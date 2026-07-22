import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession, ViewerUser
from app.db.models import AuditLog
from app.schemas.vms import AuditLogRead
from app.services.vms import get_vm_or_404

router = APIRouter()


@router.get("", response_model=list[AuditLogRead])
def get_audit_log(
    vm_id: uuid.UUID,
    db: DbSession,
    _: ViewerUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AuditLog]:
    get_vm_or_404(db, vm_id)
    return list(
        db.scalars(
            select(AuditLog)
            .options(joinedload(AuditLog.user))
            .where(AuditLog.vm_id == vm_id)
            .order_by(AuditLog.changed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
