"""Add backup_location column to vms.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-11

"""

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vms",
        sa.Column("backup_location", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vms", "backup_location")
