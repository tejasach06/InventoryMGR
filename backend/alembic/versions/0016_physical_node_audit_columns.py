"""Backfill audit + timestamp columns on physical_nodes for deployments that already ran 0015.

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "physical_nodes",
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "physical_nodes",
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "physical_nodes",
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.add_column(
        "physical_nodes",
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.execute(
        """
        UPDATE physical_nodes n
        SET created_by_id = c.created_by_id,
            updated_by_id = c.updated_by_id
        FROM physical_clusters c
        WHERE n.cluster_id = c.id
        """
    )
    op.alter_column("physical_nodes", "created_by_id", nullable=False)
    op.alter_column("physical_nodes", "updated_by_id", nullable=False)


def downgrade() -> None:
    op.drop_column("physical_nodes", "updated_at")
    op.drop_column("physical_nodes", "created_at")
    op.drop_column("physical_nodes", "updated_by_id")
    op.drop_column("physical_nodes", "created_by_id")
