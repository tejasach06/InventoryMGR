from pydantic import BaseModel, Field, field_validator

from app.schemas.users import UserRead, normalize_email


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)


class LoginResponse(BaseModel):
    user: UserRead


class SetupStatusResponse(BaseModel):
    setup_required: bool


class SetupAdminRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)
