"""Add archived/decommissioned VmStatus values and health_score column

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004_frd_schema_expansion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend enum — must happen outside any active transaction on PG
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived'")
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'decommissioned'")

    # Add health_score column with default 0
    op.add_column("vms", sa.Column("health_score", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_vms_health_score", "vms", ["health_score"])

    # Backfill: replicate the Python scoring weights in SQL
    # description=10, any_owner=15, monitoring=10, decommission_date=15
    # (apps/networks/disks require subquery counts — computed via CASE)
    op.execute("""
        UPDATE vms SET health_score = (
            CASE WHEN description IS NOT NULL AND length(trim(description)) > 0 THEN 10 ELSE 0 END
            + CASE WHEN business_owner IS NOT NULL OR technical_owner IS NOT NULL OR owner IS NOT NULL THEN 15 ELSE 0 END
            + CASE WHEN monitoring_enabled THEN 10 ELSE 0 END
            + CASE WHEN decommission_date IS NOT NULL THEN 15 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_applications WHERE vm_applications.vm_id = vms.id) THEN 20 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_networks WHERE vm_networks.vm_id = vms.id) THEN 15 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_disks WHERE vm_disks.vm_id = vms.id) THEN 15 ELSE 0 END
        )
    """)


def downgrade() -> None:
    op.drop_index("ix_vms_health_score", table_name="vms")
    op.drop_column("vms", "health_score")
    # Note: Postgres does not support removing enum values; archived/decommissioned remain
