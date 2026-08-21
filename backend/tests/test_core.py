# backend/tests/test_core.py
import pytest

from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.security import (
    create_refresh_token,
    create_session_token,
    decode_refresh_token,
    decode_session_token,
    derive_csrf_token,
    hash_password,
    make_csrf_token,
    verify_csrf_token,
    verify_password,
)


def test_settings_load():
    settings = get_settings()
    assert settings.app_env == "test"

def test_crypto_roundtrip():
    secret = "my-secret-data"
    token = encrypt_secret(secret)
    assert decrypt_secret(token) == secret
    assert decrypt_secret("invalid") is None

def test_password_hashing():
    password = "password123"
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    assert not verify_password("wrong", hashed)

def test_csrf_token():
    session_token = "some-token"
    csrf = derive_csrf_token(session_token)
    assert len(csrf) > 0

def test_session_token():
    user_id = "user123"
    role = "admin"
    token = create_session_token(user_id, role)
    decoded = decode_session_token(token)
    assert decoded["sub"] == user_id
    assert decoded["role"] == role

def test_csrf_verification():
    session_token = "test-session"
    csrf = derive_csrf_token(session_token)
    assert verify_csrf_token(csrf, session_token) is True
    assert verify_csrf_token("invalid", session_token) is False

def test_make_csrf_token():
    token = make_csrf_token()
    assert len(token) > 20
    assert token != make_csrf_token()

def test_refresh_token_roundtrip():
    user_id = "user123"
    token = create_refresh_token(user_id, persist=True)
    decoded = decode_refresh_token(token)
    assert decoded["sub"] == user_id
    assert decoded["type"] == "refresh"
    assert decoded["persist"] is True
    
    token = create_refresh_token(user_id, persist=False)
    decoded = decode_refresh_token(token)
    assert decoded["persist"] is False

def test_settings_cors_origins():
    from app.core.config import Settings
    s = Settings(app_cors_origins="http://a.com, http://b.com , , http://c.com")
    assert s.cors_origins == ["http://a.com", "http://b.com", "http://c.com"]
    s = Settings(app_cors_origins="")
    assert s.cors_origins == []

def test_settings_secure_cookies():
    from app.core.config import Settings
    s_dev = Settings(app_env="development")
    assert s_dev.secure_cookies is False
    s_prod = Settings(app_env="production")
    assert s_prod.secure_cookies is True

def test_validate_production_settings():
    from app.core.config import PLACEHOLDER_SECRET, Settings, validate_production_settings
    # Development is fine
    s_dev = Settings(app_env="development", jwt_secret=PLACEHOLDER_SECRET)
    validate_production_settings(s_dev)
    # Production with placeholder fails
    s_prod_bad = Settings(app_env="production", jwt_secret=PLACEHOLDER_SECRET)
    with pytest.raises(RuntimeError, match="JWT_SECRET must be set"):
        validate_production_settings(s_prod_bad)
    # Production with strong secret passes
    s_prod_good = Settings(app_env="production", jwt_secret="a-very-strong-secret-that-is-long-enough")
    validate_production_settings(s_prod_good)
