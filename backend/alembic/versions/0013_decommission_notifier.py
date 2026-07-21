"""Add app_settings + decommission_acks; seed decommission_notify_days=30.

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.String(length=255), nullable=False),
    )
    op.create_table(
        "decommission_acks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vm_id",
            UUID(as_uuid=True),
            sa.ForeignKey("vms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("acked_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "vm_id", name="uq_decommission_ack_user_vm"),
    )
    op.execute("INSERT INTO app_settings (key, value) VALUES ('decommission_notify_days', '30')")


def downgrade() -> None:
    op.drop_table("decommission_acks")
    op.drop_table("app_settings")
