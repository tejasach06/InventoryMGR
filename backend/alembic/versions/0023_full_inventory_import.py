"""full inventory import

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE import_action ADD VALUE IF NOT EXISTS 'decommission'")
    op.add_column(
        "csv_import_batches",
        sa.Column("full_inventory", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("csv_import_batches", "full_inventory")
    # import_action value 'decommission' intentionally retained: Postgres cannot drop an enum value in place.
