"""Storage arrays + volumes + luns + nfs shares; cluster dropdown category; storage warn pct.

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

# create_type=False: the type is created explicitly (guarded) in upgrade();
# without this, op.create_table would emit a second unguarded CREATE TYPE.
storage_vendor = sa.Enum("synology", "netapp", name="storage_vendor", create_type=False)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE dropdown_category ADD VALUE IF NOT EXISTS 'cluster'")

    sa.Enum("synology", "netapp", name="storage_vendor").create(op.get_bind(), checkfirst=True)
    op.create_table(
        "storage_arrays",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("vendor", storage_vendor, nullable=False),
        sa.Column("model", sa.String(255)),
        sa.Column("mgmt_host", sa.String(255)),
        sa.Column("datacenter", sa.String(255)),
        sa.Column("description", sa.Text()),
        sa.Column("total_capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_storage_arrays_name_nonempty"),
    )
    op.create_table(
        "storage_volumes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "array_id",
            UUID(as_uuid=True),
            sa.ForeignKey("storage_arrays.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("capacity_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "storage_luns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "volume_id",
            UUID(as_uuid=True),
            sa.ForeignKey("storage_volumes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_gb", sa.Integer()),
        sa.Column("target_iqn", sa.String(255)),
        sa.Column("cluster", sa.String(255)),
        sa.Column("status", sa.String(100)),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "storage_nfs_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "volume_id",
            UUID(as_uuid=True),
            sa.ForeignKey("storage_volumes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("export_path", sa.String(500), nullable=False),
        sa.Column("used_gb", sa.Integer()),
        sa.Column("allowed_clients", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    # Seed cluster dropdown from existing distinct VM clusters + the storage warn-pct setting.
    op.execute(
        "INSERT INTO dropdown_options (id, category, value, created_at, updated_at) "
        "SELECT gen_random_uuid(), 'cluster', cluster, now(), now() "
        "FROM (SELECT DISTINCT cluster FROM vms WHERE cluster IS NOT NULL) s"
    )
    op.execute("INSERT INTO app_settings (key, value) VALUES ('storage_usage_warn_pct', '85')")


def downgrade() -> None:
    op.drop_table("storage_nfs_shares")
    op.drop_table("storage_luns")
    op.drop_table("storage_volumes")
    op.drop_table("storage_arrays")
    storage_vendor.drop(op.get_bind(), checkfirst=True)
    op.execute("DELETE FROM app_settings WHERE key = 'storage_usage_warn_pct'")
    op.execute("DELETE FROM dropdown_options WHERE category = 'cluster'")
    # ponytail: leaving the 'cluster' enum value in place — Postgres cannot DROP an enum value.
