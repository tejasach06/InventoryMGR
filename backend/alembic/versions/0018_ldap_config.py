"""LDAP configuration and user auth source.

Revision ID: 0018
Revises: 0017
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
user_role = ENUM("viewer", "editor", "admin", name="user_role", create_type=False)



def upgrade() -> None:
    op.add_column(
        "users", sa.Column("auth_source", sa.String(16), nullable=False, server_default="local")
    )
    op.create_table(
        "ldap_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("server_uri", sa.String(255), nullable=False),
        sa.Column("start_tls", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("verify_tls", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("bind_dn", sa.String(512)),
        sa.Column("bind_password_encrypted", sa.Text()),
        sa.Column("user_base_dn", sa.String(512), nullable=False),
        sa.Column("user_filter", sa.String(512), nullable=False, server_default="(uid={username})"),
        sa.Column("email_attribute", sa.String(64), nullable=False, server_default="mail"),
        sa.Column("group_attribute", sa.String(64), nullable=False, server_default="memberOf"),
        sa.Column("admin_group_dn", sa.String(512)),
        sa.Column("editor_group_dn", sa.String(512)),
        sa.Column("viewer_group_dn", sa.String(512)),
        sa.Column("default_role", user_role, nullable=False, server_default="viewer"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_ldap_config_singleton"),
    )


def downgrade() -> None:
    op.drop_table("ldap_config")
    op.drop_column("users", "auth_source")
