from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import AdminUser, Csrf, DbSession, ViewerUser
from app.db.models import DropdownCategory, DropdownOption, OsFamily, UserRole
from app.schemas.ldap import LdapConfigRead, LdapConfigUpdate, LdapTestRequest, LdapTestResult
from app.schemas.settings import (
    AppSettingsRead,
    AppSettingsUpdate,
    GroupedDropdownOptions,
)
from app.services import app_settings, ldap_auth

router = APIRouter()


# ponytail: populating dropdown suggestions now requires direct SQL/seed; re-add an admin CRUD UI in SettingsPage if curated options are needed.

@router.get("/options", response_model=GroupedDropdownOptions)
def list_options(db: DbSession, _: ViewerUser) -> GroupedDropdownOptions:
    grouped: dict[str, list[str]] = {category.value: [] for category in DropdownCategory}
    os_by_family: dict[str, list[str]] = {family.value: [] for family in OsFamily}
    options = db.scalars(
        select(DropdownOption).order_by(DropdownOption.category, DropdownOption.value)
    ).all()
    for option in options:
        grouped[option.category.value].append(option.value)
        if option.category == DropdownCategory.os and option.family is not None:
            os_by_family[option.family.value].append(option.value)
    return GroupedDropdownOptions(**grouped, os_by_family=os_by_family)


@router.get("/app", response_model=AppSettingsRead)
def get_app_settings(db: DbSession, _: AdminUser) -> AppSettingsRead:
    return AppSettingsRead(
        decommission_notify_days=app_settings.get_notify_days(db),
        storage_usage_warn_pct=app_settings.get_warn_pct(db),
    )


@router.patch("/app", response_model=AppSettingsRead)
def update_app_settings(
    payload: AppSettingsUpdate, db: DbSession, _: AdminUser, __: Csrf
) -> AppSettingsRead:
    if payload.decommission_notify_days is not None:
        app_settings.set_notify_days(db, payload.decommission_notify_days)
    if payload.storage_usage_warn_pct is not None:
        app_settings.set_warn_pct(db, payload.storage_usage_warn_pct)
    return AppSettingsRead(
        decommission_notify_days=app_settings.get_notify_days(db),
        storage_usage_warn_pct=app_settings.get_warn_pct(db),
    )


def _ldap_read(config) -> LdapConfigRead:
    if config is None:
        return LdapConfigRead(
            enabled=False,
            server_uri="",
            start_tls=False,
            verify_tls=True,
            bind_dn=None,
            bind_password_set=False,
            user_base_dn="",
            user_filter="(uid={username})",
            email_attribute="mail",
            group_attribute="memberOf",
            admin_group_dn=None,
            editor_group_dn=None,
            viewer_group_dn=None,
            default_role=UserRole.viewer,
        )
    return LdapConfigRead(
        enabled=config.enabled,
        server_uri=config.server_uri,
        start_tls=config.start_tls,
        verify_tls=config.verify_tls,
        bind_dn=config.bind_dn,
        bind_password_set=bool(config.bind_password_encrypted),
        user_base_dn=config.user_base_dn,
        user_filter=config.user_filter,
        email_attribute=config.email_attribute,
        group_attribute=config.group_attribute,
        admin_group_dn=config.admin_group_dn,
        editor_group_dn=config.editor_group_dn,
        viewer_group_dn=config.viewer_group_dn,
        default_role=config.default_role,
    )


@router.get("/ldap", response_model=LdapConfigRead)
def get_ldap_config(db: DbSession, _: AdminUser) -> LdapConfigRead:
    return _ldap_read(ldap_auth.get_config(db))


@router.put("/ldap", response_model=LdapConfigRead)
def update_ldap_config(
    payload: LdapConfigUpdate, db: DbSession, _: AdminUser, __: Csrf
) -> LdapConfigRead:
    return _ldap_read(ldap_auth.save_config(db, payload))


@router.post("/ldap/test", response_model=LdapTestResult)
def test_ldap_config(
    payload: LdapTestRequest, db: DbSession, _: AdminUser, __: Csrf
) -> LdapTestResult:
    return ldap_auth.test_connection(db, payload)
