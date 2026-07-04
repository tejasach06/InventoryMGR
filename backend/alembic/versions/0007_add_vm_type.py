"""Add vm_type column (permanent/temporary) to vms.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

vm_type_enum = sa.Enum("permanent", "temporary", name="vm_type")


def upgrade() -> None:
    vm_type_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "vms",
        sa.Column("vm_type", vm_type_enum, nullable=False, server_default="permanent"),
    )
    op.create_index("ix_vms_vm_type", "vms", ["vm_type"])


def downgrade() -> None:
    op.drop_index("ix_vms_vm_type", table_name="vms")
    op.drop_column("vms", "vm_type")
    vm_type_enum.drop(op.get_bind(), checkfirst=True)
