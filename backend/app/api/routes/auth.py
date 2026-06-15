from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select, text

from app.api.deps import Csrf, CurrentUser, DbSession
from app.core.config import get_settings
from app.core.security import create_session_token, hash_password, make_csrf_token, verify_password
from app.db.models import User, UserRole
from app.schemas.auth import LoginRequest, LoginResponse, SetupAdminRequest, SetupStatusResponse
from app.schemas.users import UserRead

router = APIRouter()


def _set_auth_cookies(response: Response, *, token: str, csrf: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf,
        httponly=False,
        secure=settings.secure_cookies,
        samesite="lax",
    )


def _clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name, secure=settings.secure_cookies, samesite="lax"
    )
    response.delete_cookie(
        settings.csrf_cookie_name, secure=settings.secure_cookies, samesite="lax"
    )


def _any_users_exist(db: DbSession) -> bool:
    return (db.scalar(select(func.count()).select_from(User)) or 0) > 0


@router.get("/setup", response_model=SetupStatusResponse)
def setup_status(db: DbSession) -> SetupStatusResponse:
    return SetupStatusResponse(setup_required=not _any_users_exist(db))


@router.post("/setup", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def setup_admin(payload: SetupAdminRequest, response: Response, db: DbSession) -> LoginResponse:
    db.execute(text("LOCK TABLE users IN EXCLUSIVE MODE"))
    if _any_users_exist(db):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Setup has already been completed"
        )
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    csrf = make_csrf_token()
    token = create_session_token(str(user.id), user.role.value, csrf)
    _set_auth_cookies(response, token=token, csrf=csrf)
    return LoginResponse(user=UserRead.model_validate(user))


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response, db: DbSession) -> LoginResponse:
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    csrf = make_csrf_token()
    token = create_session_token(str(user.id), user.role.value, csrf)
    _set_auth_cookies(response, token=token, csrf=csrf)
    return LoginResponse(user=UserRead.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _: CurrentUser, __: Csrf) -> None:
    _clear_auth_cookies(response)


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser) -> User:
    return current_user
