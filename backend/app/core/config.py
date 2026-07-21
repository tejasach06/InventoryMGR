from functools import lru_cache

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://inventorymgr@127.0.0.1:54329/inventorymgr",
        alias="DATABASE_URL",
    )
    test_database_url: str = Field(
        default="postgresql+psycopg://inventorymgr@127.0.0.1:54329/inventorymgr_test",
        alias="TEST_DATABASE_URL",
    )
    jwt_secret: str = Field(default="replace-with-32-byte-random-secret", alias="JWT_SECRET")
    session_cookie_name: str = Field(default="inventorymgr_session", alias="SESSION_COOKIE_NAME")
    csrf_cookie_name: str = Field(default="inventorymgr_csrf", alias="CSRF_COOKIE_NAME")
    app_cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="APP_CORS_ORIGINS",
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.app_cors_origins.split(",") if origin.strip()]

    @property
    def secure_cookies(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


PLACEHOLDER_SECRET = "replace-with-32-byte-random-secret"


def validate_production_settings(settings: Settings) -> None:
    if settings.app_env not in ("development", "test") and (
        not settings.jwt_secret or settings.jwt_secret == PLACEHOLDER_SECRET
    ):
        raise RuntimeError("JWT_SECRET must be set to a strong random value in production")
