"""Remove VM lifecycle field

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


lifecycle = postgresql.ENUM("planned", "active", "retiring", "retired", name="lifecycle")


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vms_lifecycle")
    op.execute("ALTER TABLE vms DROP COLUMN IF EXISTS lifecycle")
    lifecycle.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    lifecycle.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "vms",
        sa.Column(
            "lifecycle",
            lifecycle,
            nullable=False,
            server_default="active",
        ),
    )
    op.alter_column("vms", "lifecycle", server_default=None)
    op.create_index("ix_vms_lifecycle", "vms", ["lifecycle"])
