"""Add import change tracking: unchanged action, row changes, batch rollups.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("COMMIT")
    op.execute("ALTER TYPE import_action ADD VALUE IF NOT EXISTS 'unchanged' AFTER 'update'")
    op.add_column(
        "csv_import_rows",
        sa.Column("changes", JSONB, nullable=False, server_default="{}"),
    )
    op.add_column(
        "csv_import_batches",
        sa.Column("field_changes", JSONB, nullable=False, server_default="{}"),
    )
    op.add_column(
        "csv_import_batches",
        sa.Column("ignored_columns", JSONB, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("csv_import_batches", "ignored_columns")
    op.drop_column("csv_import_batches", "field_changes")
    op.drop_column("csv_import_rows", "changes")
    # Postgres cannot drop a value from an enum type. Leaving 'unchanged' in
    # place is harmless: no row references it once the columns above are gone.
