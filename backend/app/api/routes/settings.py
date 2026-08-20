import uuid

from fastapi import APIRouter, HTTPException, status
from psycopg.errors import UniqueViolation
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, Csrf, DbSession, ViewerUser
from app.db.models import DropdownCategory, DropdownOption, OsFamily, UserRole
from app.schemas.ldap import LdapConfigRead, LdapConfigUpdate, LdapTestRequest, LdapTestResult
from app.schemas.settings import (
    AppSettingsRead,
    AppSettingsUpdate,
    DropdownOptionCreate,
    DropdownOptionRead,
    DropdownOptionUpdate,
    GroupedDropdownOptions,
)
from app.services import app_settings, ldap_auth

router = APIRouter()

OPTION_CONFLICT = "Dropdown option already exists for this category"


def _raise_option_conflict(exc: IntegrityError) -> None:
    msg = str(exc.orig) if exc.orig else str(exc)
    if (
        isinstance(exc.orig, UniqueViolation)
        or "uq_dropdown_category_value" in msg
        or "UNIQUE constraint failed" in msg
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=OPTION_CONFLICT) from exc
    raise exc


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


@router.post("/options", response_model=DropdownOptionRead, status_code=status.HTTP_201_CREATED)
def create_option(
    payload: DropdownOptionCreate, db: DbSession, _: AdminUser, __: Csrf
) -> DropdownOption:
    option = DropdownOption(
        category=payload.category,
        value=payload.normalized_value(),
        family=payload.family if payload.category == DropdownCategory.os else None,
    )
    db.add(option)
    try:
        db.commit()
        db.refresh(option)
    except IntegrityError as exc:
        db.rollback()
        _raise_option_conflict(exc)
    return option


@router.get("/options/all", response_model=list[DropdownOptionRead])
def list_all_options(db: DbSession, _: AdminUser) -> list[DropdownOption]:
    return list(
        db.scalars(
            select(DropdownOption).order_by(DropdownOption.category, DropdownOption.value)
        ).all()
    )


@router.patch("/options/{option_id}", response_model=DropdownOptionRead)
def update_option(
    option_id: uuid.UUID,
    payload: DropdownOptionUpdate,
    db: DbSession,
    _: AdminUser,
    __: Csrf,
) -> DropdownOption:
    option = db.get(DropdownOption, option_id)
    if option is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dropdown option not found"
        )
    option.value = payload.normalized_value()
    option.family = payload.family if option.category == DropdownCategory.os else None
    try:
        db.commit()
        db.refresh(option)
    except IntegrityError as exc:
        db.rollback()
        _raise_option_conflict(exc)
    return option


@router.delete("/options/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_option(option_id: uuid.UUID, db: DbSession, _: AdminUser, __: Csrf) -> None:
    option = db.get(DropdownOption, option_id)
    if option is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dropdown option not found"
        )
    db.delete(option)
    db.commit()


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
