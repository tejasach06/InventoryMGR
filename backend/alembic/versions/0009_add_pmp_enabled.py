"""Add pmp_enabled column to vms; drop department.

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-11

"""

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vms",
        sa.Column("pmp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_vms_pmp_enabled", "vms", ["pmp_enabled"])
    op.drop_column("vms", "department")


def downgrade() -> None:
    op.add_column("vms", sa.Column("department", sa.String(255), nullable=True))
    op.drop_index("ix_vms_pmp_enabled", table_name="vms")
    op.drop_column("vms", "pmp_enabled")
