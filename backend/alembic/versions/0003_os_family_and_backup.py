"""Add os_family, replace backup_status with backup_enabled, tag dropdown options with family.

Revision ID: 0003_os_family_and_backup
Revises: 0002_add_settings_and_sr_id
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_os_family_and_backup"
down_revision: str | None = "0002_add_settings_and_sr_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

os_family = postgresql.ENUM("linux", "windows", name="os_family", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    os_family.create(bind, checkfirst=True)

    # VM: optional OS family + boolean backup toggle (replaces free-text backup_status).
    op.add_column("vms", sa.Column("os_family", os_family, nullable=True))
    op.add_column(
        "vms",
        sa.Column("backup_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("vms", "backup_enabled", server_default=None)
    op.drop_column("vms", "backup_status")

    # Dropdown options: tag OS values with a family so the form can scope suggestions.
    op.add_column("dropdown_options", sa.Column("family", os_family, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_column("dropdown_options", "family")
    op.add_column("vms", sa.Column("backup_status", sa.String(length=255), nullable=True))
    op.drop_column("vms", "backup_enabled")
    op.drop_column("vms", "os_family")

    os_family.drop(bind, checkfirst=True)
