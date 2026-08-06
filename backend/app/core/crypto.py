import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    # ponytail: rotating JWT_SECRET requires re-entering bind password; add LDAP_ENCRYPTION_KEY to rotate independently.
    key = base64.urlsafe_b64encode(hashlib.sha256(get_settings().jwt_secret.encode()).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None
