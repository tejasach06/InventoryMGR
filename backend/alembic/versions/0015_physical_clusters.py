"""Physical clusters + nodes.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "physical_clusters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_physical_clusters_name_nonempty"),
    )
    op.create_table(
        "physical_nodes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "cluster_id",
            UUID(as_uuid=True),
            sa.ForeignKey("physical_clusters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("cpu_model", sa.String(255)),
        sa.Column("cpu_cores", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cpu_threads", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ram_total_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ram_used_gb", sa.Integer()),
        sa.Column("storage_usable_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("datacenter", sa.String(255)),
        sa.Column("rack", sa.String(100)),
        sa.Column("rack_unit", sa.String(50)),
        sa.Column(
            "ip_addresses", JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"
        ),
        sa.Column("notes", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_physical_nodes_name_nonempty"),
        sa.CheckConstraint("cpu_cores >= 0", name="ck_physical_nodes_cpu_cores_nonnegative"),
        sa.CheckConstraint("cpu_threads >= 0", name="ck_physical_nodes_cpu_threads_nonnegative"),
        sa.CheckConstraint("ram_total_gb >= 0", name="ck_physical_nodes_ram_total_nonnegative"),
        sa.CheckConstraint("storage_usable_gb >= 0", name="ck_physical_nodes_storage_nonnegative"),
    )


def downgrade() -> None:
    op.drop_table("physical_nodes")
    op.drop_table("physical_clusters")
