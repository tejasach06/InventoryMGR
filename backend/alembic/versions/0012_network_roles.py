"""Add role to vm_networks: private/public/backup, existing rows backfill to private.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

network_role = sa.Enum("private", "public", "backup", name="network_role")


def upgrade() -> None:
    network_role.create(op.get_bind(), checkfirst=True)
    # NOT NULL + server default backfills every existing row to private in one
    # statement; no separate UPDATE needed.
    op.add_column(
        "vm_networks",
        sa.Column("role", network_role, nullable=False, server_default="private"),
    )


def downgrade() -> None:
    op.drop_column("vm_networks", "role")
    network_role.drop(op.get_bind(), checkfirst=True)
