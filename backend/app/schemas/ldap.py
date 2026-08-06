from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models import UserRole


class LdapConfigRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    server_uri: str
    start_tls: bool
    verify_tls: bool
    bind_dn: str | None
    bind_password_set: bool
    user_base_dn: str
    user_filter: str
    email_attribute: str
    group_attribute: str
    admin_group_dn: str | None
    editor_group_dn: str | None
    viewer_group_dn: str | None
    default_role: UserRole


class LdapConfigUpdate(BaseModel):
    enabled: bool
    server_uri: str = Field(min_length=1, max_length=255)
    start_tls: bool = False
    verify_tls: bool = True
    bind_dn: str | None = None
    bind_password: str | None = None
    user_base_dn: str = Field(min_length=1, max_length=512)
    user_filter: str = Field(default="(uid={username})", min_length=1, max_length=512)
    email_attribute: str = Field(default="mail", max_length=64)
    group_attribute: str = Field(default="memberOf", max_length=64)
    admin_group_dn: str | None = None
    editor_group_dn: str | None = None
    viewer_group_dn: str | None = None
    default_role: UserRole = UserRole.viewer

    @model_validator(mode="after")
    def validate_ldap_values(self) -> "LdapConfigUpdate":
        if not self.server_uri.startswith(("ldap://", "ldaps://")):
            raise ValueError("server_uri must start with ldap:// or ldaps://")
        if "{username}" not in self.user_filter and "{email}" not in self.user_filter:
            raise ValueError("user_filter must contain {username} or {email}")
        return self


class LdapTestRequest(BaseModel):
    username: str | None = None
    password: str | None = None


class LdapTestResult(BaseModel):
    ok: bool
    message: str
