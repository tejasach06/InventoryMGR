"""Initial InventoryMGR schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

user_role = postgresql.ENUM("admin", "editor", "viewer", name="user_role", create_type=False)
platform = postgresql.ENUM("proxmox", "vmware", name="platform", create_type=False)
vm_status = postgresql.ENUM(
    "running", "stopped", "suspended", "unknown", name="vm_status", create_type=False
)
criticality = postgresql.ENUM("low", "medium", "high", "critical", name="criticality", create_type=False)
lifecycle = postgresql.ENUM(
    "planned", "active", "retiring", "retired", name="lifecycle", create_type=False
)
import_status = postgresql.ENUM(
    "previewed", "committed", "cancelled", name="import_status", create_type=False
)
import_action = postgresql.ENUM(
    "create", "update", "conflict", "invalid", name="import_action", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    platform.create(bind, checkfirst=True)
    vm_status.create(bind, checkfirst=True)
    criticality.create(bind, checkfirst=True)
    lifecycle.create(bind, checkfirst=True)
    import_status.create(bind, checkfirst=True)
    import_action.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "vms",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("platform", platform, nullable=False),
        sa.Column("datacenter", sa.String(length=255), nullable=True),
        sa.Column("cluster", sa.String(length=255), nullable=False),
        sa.Column("status", vm_status, nullable=False),
        sa.Column("cpu_cores", sa.Integer(), nullable=False),
        sa.Column("memory_mb", sa.Integer(), nullable=False),
        sa.Column("disk_gb", sa.Integer(), nullable=False),
        sa.Column("os_name", sa.String(length=255), nullable=True),
        sa.Column("ip_addresses", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("owner", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("backup_status", sa.String(length=255), nullable=True),
        sa.Column("ha_enabled", sa.Boolean(), nullable=False),
        sa.Column("criticality", criticality, nullable=False),
        sa.Column("lifecycle", lifecycle, nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("last_verified_at", sa.Date(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_vms_name_nonempty"),
        sa.CheckConstraint("length(btrim(cluster)) > 0", name="ck_vms_cluster_nonempty"),
        sa.CheckConstraint("cpu_cores >= 0", name="ck_vms_cpu_cores_nonnegative"),
        sa.CheckConstraint("memory_mb >= 0", name="ck_vms_memory_mb_nonnegative"),
        sa.CheckConstraint("disk_gb >= 0", name="ck_vms_disk_gb_nonnegative"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vms_platform", "vms", ["platform"])
    op.create_index("ix_vms_cluster", "vms", ["cluster"])
    op.create_index("ix_vms_status", "vms", ["status"])
    op.create_index("ix_vms_criticality", "vms", ["criticality"])
    op.create_index("ix_vms_lifecycle", "vms", ["lifecycle"])
    op.create_index(
        "uq_vms_platform_external_id",
        "vms",
        ["platform", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.create_index(
        "uq_vms_platform_name_without_external_id",
        "vms",
        ["platform", sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("external_id IS NULL"),
    )

    op.create_table(
        "csv_import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", import_status, nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "csv_import_rows",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("normalized", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("action", import_action, nullable=False),
        sa.Column("target_vm_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("errors", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["csv_import_batches.id"]),
        sa.ForeignKeyConstraint(["target_vm_id"], ["vms.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "row_number", name="uq_csv_import_rows_batch_row"),
    )


def downgrade() -> None:
    op.drop_table("csv_import_rows")
    op.drop_table("csv_import_batches")
    op.drop_index("uq_vms_platform_name_without_external_id", table_name="vms")
    op.drop_index("uq_vms_platform_external_id", table_name="vms")
    op.drop_index("ix_vms_lifecycle", table_name="vms")
    op.drop_index("ix_vms_criticality", table_name="vms")
    op.drop_index("ix_vms_status", table_name="vms")
    op.drop_index("ix_vms_cluster", table_name="vms")
    op.drop_index("ix_vms_platform", table_name="vms")
    op.drop_table("vms")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    import_action.drop(bind, checkfirst=True)
    import_status.drop(bind, checkfirst=True)
    lifecycle.drop(bind, checkfirst=True)
    criticality.drop(bind, checkfirst=True)
    vm_status.drop(bind, checkfirst=True)
    platform.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
