"""Add partial index on audit_log for powered_off status transitions.

Revision ID: 0020
Revises: 0019
"""
import sqlalchemy as sa

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_audit_log_powered_off",
        "audit_log",
        ["vm_id", sa.text("changed_at DESC")],
        postgresql_where=sa.text("field_name = 'status' AND new_value = 'powered_off'"),
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_powered_off", table_name="audit_log")
