import uuid

from fastapi import APIRouter, HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, Csrf, DbSession
from app.core.security import hash_password
from app.db.models import User, UserRole
from app.schemas.users import UserCreate, UserPatch, UserRead

router = APIRouter()


def _is_last_active_admin(db: DbSession, user: User) -> bool:
    if user.role != UserRole.admin or not user.is_active:
        return False
    active_admins = (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.admin, User.is_active.is_(True))
        )
        or 0
    )
    return active_admins <= 1


def _raise_unique_email(exc: IntegrityError) -> None:
    if isinstance(exc.orig, UniqueViolation) or "users_email" in str(exc.orig):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User email already exists"
        ) from exc
    raise exc


@router.get("", response_model=list[UserRead])
def list_users(db: DbSession, _: AdminUser) -> list[User]:
    return list(db.scalars(select(User).order_by(User.email.asc())).all())


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession, _: AdminUser, __: Csrf) -> User:
    user = User(
        email=payload.email.strip().lower(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        _raise_unique_email(exc)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def patch_user(
    user_id: uuid.UUID, payload: UserPatch, db: DbSession, _: AdminUser, __: Csrf
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    next_role = payload.role if payload.role is not None else user.role
    next_active = payload.is_active if payload.is_active is not None else user.is_active
    if _is_last_active_admin(db, user) and (next_role != UserRole.admin or not next_active):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot remove the last active admin",
        )

    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user
