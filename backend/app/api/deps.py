import uuid
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_session_token, verify_csrf_token
from app.db.models import User, UserRole
from app.db.session import get_db

DbSession = Annotated[Session, Depends(get_db)]

ROLE_ORDER = {UserRole.viewer: 1, UserRole.editor: 2, UserRole.admin: 3}


def _session_cookie(request: Request) -> str | None:
    settings = get_settings()
    return request.cookies.get(settings.session_cookie_name)


def get_session_payload(request: Request) -> dict:
    token = _session_cookie(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        return decode_session_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        ) from exc


def get_current_user(db: DbSession, request: Request) -> User:
    payload = get_session_payload(request)
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        ) from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user"
        )
    return user


def require_csrf(
    request: Request, x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None
) -> None:
    session_token = _session_cookie(request)
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not x_csrf_token or not verify_csrf_token(x_csrf_token, session_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


def require_role(min_role: UserRole):
    def dependency(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if ROLE_ORDER[current_user.role] < ROLE_ORDER[min_role]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return current_user

    return dependency


CurrentUser = Annotated[User, Depends(get_current_user)]
ViewerUser = Annotated[User, Depends(require_role(UserRole.viewer))]
EditorUser = Annotated[User, Depends(require_role(UserRole.editor))]
AdminUser = Annotated[User, Depends(require_role(UserRole.admin))]
Csrf = Annotated[None, Depends(require_csrf)]
