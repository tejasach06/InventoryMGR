# backend/tests/test_core.py
import pytest
from app.core.config import get_settings
from app.core.crypto import encrypt_secret, decrypt_secret
from app.core.security import hash_password, verify_password, derive_csrf_token, create_session_token, decode_session_token

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
