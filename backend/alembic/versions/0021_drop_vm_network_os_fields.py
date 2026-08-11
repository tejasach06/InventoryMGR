"""Drop unused VM OS/network detail columns.

Revision ID: 0021
Revises: 0020
"""
import sqlalchemy as sa

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("vm_networks", "gateway")
    op.drop_column("vm_networks", "vlan")
    op.drop_column("vms", "os_name")


def downgrade() -> None:
    op.add_column("vms", sa.Column("os_name", sa.String(length=255), nullable=True))
    op.add_column("vm_networks", sa.Column("vlan", sa.Integer(), nullable=True))
    op.add_column("vm_networks", sa.Column("gateway", sa.String(length=50), nullable=True))
