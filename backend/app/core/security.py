import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"
SESSION_TTL_MINUTES = 12 * 60


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def make_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def create_session_token(user_id: str, role: str, csrf: str) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=SESSION_TTL_MINUTES)
    payload: dict[str, Any] = {"sub": user_id, "role": role, "csrf": csrf, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
