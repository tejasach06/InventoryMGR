import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"
SESSION_TTL_MINUTES = 12 * 60
REFRESH_TTL_MINUTES = 7 * 24 * 60


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def derive_csrf_token(session_token: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.jwt_secret.encode(),
        session_token.encode(),
        hashlib.sha256,
    ).hexdigest()


def verify_csrf_token(provided: str, session_token: str) -> bool:
    expected = derive_csrf_token(session_token)
    return hmac.compare_digest(provided, expected)


def make_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def create_session_token(user_id: str, role: str) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=SESSION_TTL_MINUTES)
    payload: dict[str, Any] = {"sub": user_id, "role": role, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])


def create_refresh_token(user_id: str) -> str:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=REFRESH_TTL_MINUTES)
    payload: dict[str, Any] = {"sub": user_id, "type": "refresh", "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_refresh_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
