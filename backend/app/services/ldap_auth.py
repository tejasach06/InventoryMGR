import secrets
import ssl

from ldap3 import SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.security import hash_password
from app.db.models import LdapConfig, User, UserRole
from app.schemas.ldap import LdapConfigUpdate, LdapTestRequest, LdapTestResult


def get_config(db: Session) -> LdapConfig | None:
    return db.get(LdapConfig, 1)


def save_config(db: Session, payload: LdapConfigUpdate) -> LdapConfig:
    config = get_config(db)
    if config is None:
        config = LdapConfig(id=1, server_uri=payload.server_uri, user_base_dn=payload.user_base_dn)
        db.add(config)
    for field in (
        "enabled", "server_uri", "start_tls", "verify_tls", "bind_dn", "user_base_dn",
        "user_filter", "email_attribute", "group_attribute", "admin_group_dn", "editor_group_dn",
        "viewer_group_dn", "default_role",
    ):
        setattr(config, field, getattr(payload, field))
    if payload.bind_password is not None:
        config.bind_password_encrypted = (
            encrypt_secret(payload.bind_password) if payload.bind_password else None
        )
    db.commit()
    db.refresh(config)
    return config


def _connection(config: LdapConfig) -> tuple[Server, Connection]:
    server = Server(
        config.server_uri,
        use_ssl=config.server_uri.startswith("ldaps://"),
        connect_timeout=5,
        tls=Tls(validate=ssl.CERT_REQUIRED if config.verify_tls else ssl.CERT_NONE),
    )
    password = decrypt_secret(config.bind_password_encrypted) if config.bind_password_encrypted else None
    if config.bind_dn and password is None:
        raise LDAPException("Configured LDAP bind password cannot be decrypted")
    connection = Connection(
        server, config.bind_dn or None, password, auto_bind=True, receive_timeout=5
    )
    if config.start_tls and not server.ssl:
        connection.start_tls()
    return server, connection


def _role(config: LdapConfig, groups: list[str]) -> UserRole:
    normalized_groups = {group.strip().lower() for group in groups}
    for group_dn, role in (
        (config.admin_group_dn, UserRole.admin),
        (config.editor_group_dn, UserRole.editor),
        (config.viewer_group_dn, UserRole.viewer),
    ):
        if group_dn and group_dn.strip().lower() in normalized_groups:
            return role
    return config.default_role


def _entry_values(entry: object, attribute: str) -> list[str]:
    try:
        values = entry[attribute].values  # type: ignore[index]
    except (KeyError, AttributeError):
        return []
    return [str(value) for value in values]


def _find_user(config: LdapConfig, connection: Connection, email: str):
    username = email.split("@", 1)[0] if "@" in email else email
    user_filter = config.user_filter.format(
        username=escape_filter_chars(username), email=escape_filter_chars(email)
    )
    connection.search(
        config.user_base_dn,
        user_filter,
        search_scope=SUBTREE,
        attributes=[config.email_attribute, config.group_attribute],
    )
    if len(connection.entries) != 1:
        return None
    return connection.entries[0]


def authenticate(db: Session, email: str, password: str) -> User | None:
    config = get_config(db)
    if config is None or not config.enabled or not password:
        return None
    try:
        server, connection = _connection(config)
        entry = _find_user(config, connection, email)
        if entry is None:
            return None
        Connection(server, entry.entry_dn, password, auto_bind=True, receive_timeout=5)
    except LDAPException:
        return None

    emails = _entry_values(entry, config.email_attribute)
    resolved_email = (emails[0] if emails else email if "@" in email else "").strip().lower()
    if not resolved_email:
        return None
    role = _role(config, _entry_values(entry, config.group_attribute))
    user = db.query(User).filter(User.email == resolved_email).one_or_none()
    if user is None:
        user = User(
            email=resolved_email,
            role=role,
            is_active=True,
            auth_source="ldap",
            password_hash=hash_password(secrets.token_urlsafe(32)),
        )
        db.add(user)
    elif not user.is_active:
        return None
    elif user.auth_source == "ldap":
        user.role = role
    db.commit()
    db.refresh(user)
    return user


def test_connection(db: Session, payload: LdapTestRequest) -> LdapTestResult:
    config = get_config(db)
    if config is None:
        return LdapTestResult(ok=False, message="LDAP settings have not been saved")
    try:
        server, connection = _connection(config)
        if not payload.username:
            return LdapTestResult(ok=True, message="Service bind succeeded")
        entry = _find_user(config, connection, payload.username)
        if entry is None:
            return LdapTestResult(ok=False, message="User search returned zero or multiple entries")
        role = _role(config, _entry_values(entry, config.group_attribute)).value
        if payload.password:
            Connection(server, entry.entry_dn, payload.password, auto_bind=True, receive_timeout=5)
        return LdapTestResult(ok=True, message=f"Found {entry.entry_dn}; resolved role: {role}")
    except LDAPException as exc:
        return LdapTestResult(ok=False, message=str(exc))
