"""Add CSV import row warnings.

Revision ID: 0019
Revises: 0018
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "csv_import_rows",
        sa.Column(
            "warnings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.alter_column("csv_import_rows", "warnings", server_default=None)

    op.drop_index("uq_vms_platform_external_id", table_name="vms")
    op.create_index(
        "uq_vms_platform_external_id",
        "vms",
        ["platform", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL AND platform <> 'proxmox'"),
    )
def downgrade() -> None:
    op.drop_column("csv_import_rows", "warnings")

    op.drop_index("uq_vms_platform_external_id", table_name="vms")
    op.create_index(
        "uq_vms_platform_external_id",
        "vms",
        ["platform", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )