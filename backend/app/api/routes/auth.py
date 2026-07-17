from fastapi import APIRouter, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select, text

from app.api.deps import Csrf, CurrentUser, DbSession
from app.core.config import get_settings
from app.core.security import (
    create_refresh_token,
    create_session_token,
    decode_refresh_token,
    derive_csrf_token,
    hash_password,
    verify_password,
)
from app.db.models import User, UserRole
from app.schemas.auth import LoginRequest, LoginResponse, SetupAdminRequest, SetupStatusResponse
from app.schemas.users import UserRead

router = APIRouter()
limiter = Limiter(key_func=get_remote_address, default_limits=[])

LOGIN_RATE = "10/minute"
SETUP_RATE = "3/minute"
REFRESH_COOKIE_NAME = "inventorymgr_refresh"
REFRESH_TTL_SECONDS = 7 * 24 * 3600


def _is_test_env() -> bool:
    return get_settings().app_env == "test"


def rate_limit(limit: str):

    def decorator(func):
        if _is_test_env():
            return func
        return limiter.limit(limit)(func)
    return decorator


def _set_auth_cookies(response: Response, *, token: str, csrf: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )
    # CSRF cookie is non-HTTP-only (readable by JS) by design — this enables the
    # double-submit cookie pattern where the frontend reads the cookie and sends
    # its value as the X-CSRF-Token header. The server validates they match.
    # The tradeoff: an XSS attacker who can read the CSRF cookie still cannot forge
    # requests because the session cookie remains HTTP-only.
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf,
        httponly=False,
        secure=settings.secure_cookies,
        samesite="lax",
    )


def _set_refresh_cookie(response: Response, *, refresh_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="strict",
        max_age=REFRESH_TTL_SECONDS,
        path="/api/auth/refresh",
    )


def _clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name, secure=settings.secure_cookies, samesite="lax"
    )
    response.delete_cookie(
        settings.csrf_cookie_name, secure=settings.secure_cookies, samesite="lax"
    )
    response.delete_cookie(
        REFRESH_COOKIE_NAME, secure=settings.secure_cookies, samesite="strict", path="/api/auth/refresh"
    )


def _any_users_exist(db: DbSession) -> bool:
    return (db.scalar(select(func.count()).select_from(User)) or 0) > 0


@router.get("/setup", response_model=SetupStatusResponse)
def setup_status(db: DbSession) -> SetupStatusResponse:
    return SetupStatusResponse(setup_required=not _any_users_exist(db))


@router.post("/setup", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
@rate_limit(SETUP_RATE)
def setup_admin(request: Request, payload: SetupAdminRequest, response: Response, db: DbSession) -> LoginResponse:
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
    token = create_session_token(str(user.id), user.role.value)
    csrf = derive_csrf_token(token)
    refresh_token = create_refresh_token(str(user.id))
    _set_auth_cookies(response, token=token, csrf=csrf)
    _set_refresh_cookie(response, refresh_token=refresh_token)
    return LoginResponse(user=UserRead.model_validate(user))


@router.post("/login", response_model=LoginResponse)
@rate_limit(LOGIN_RATE)
def login(request: Request, payload: LoginRequest, response: Response, db: DbSession) -> LoginResponse:
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
    token = create_session_token(str(user.id), user.role.value)
    csrf = derive_csrf_token(token)
    refresh_token = create_refresh_token(str(user.id))
    _set_auth_cookies(response, token=token, csrf=csrf)
    _set_refresh_cookie(response, refresh_token=refresh_token)
    return LoginResponse(user=UserRead.model_validate(user))


@router.post("/refresh", response_model=LoginResponse)
def refresh(request: Request, response: Response, db: DbSession) -> LoginResponse:
    refresh_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        payload = decode_refresh_token(refresh_cookie)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user"
        )
    token = create_session_token(str(user.id), user.role.value)
    csrf = derive_csrf_token(token)
    new_refresh = create_refresh_token(str(user.id))
    _set_auth_cookies(response, token=token, csrf=csrf)
    _set_refresh_cookie(response, refresh_token=new_refresh)
    return LoginResponse(user=UserRead.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _: CurrentUser, __: Csrf) -> None:
    _clear_auth_cookies(response)


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser) -> User:
    return current_user
