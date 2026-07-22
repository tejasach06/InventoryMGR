"""FRD schema expansion: environment, node, fqdn, ownership, security, normalized disks/networks/apps/attachments/audit.

Revision ID: 0004_frd_schema_expansion
Revises: 0003_os_family_and_backup
Create Date: 2026-06-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004_frd_schema_expansion"
down_revision: str | None = "0003_os_family_and_backup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

environment_enum = postgresql.ENUM(
    "production",
    "development",
    "testing",
    "uat",
    "dr",
    "staging",
    "sandbox",
    name="environment",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()

    # ── New enum type ─────────────────────────────────────────────────────────
    environment_enum.create(bind, checkfirst=True)

    # ── VmStatus: rename stopped → powered_off, add archived + decommissioned ─
    op.execute("ALTER TYPE vm_status RENAME VALUE 'stopped' TO 'powered_off'")
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived'")
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'decommissioned'")

    # ── Rename notes → description ────────────────────────────────────────────
    op.alter_column("vms", "notes", new_column_name="description")

    # ── New columns on vms ────────────────────────────────────────────────────
    op.add_column("vms", sa.Column("fqdn", sa.String(255), nullable=True))
    op.add_column("vms", sa.Column("node", sa.String(255), nullable=True))
    op.add_column(
        "vms",
        sa.Column("environment", environment_enum, nullable=False, server_default="production"),
    )
    op.alter_column("vms", "environment", server_default=None)
    op.add_column(
        "vms",
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("vms", "monitoring_enabled", server_default=None)
    op.add_column("vms", sa.Column("os_distribution", sa.String(255), nullable=True))
    op.add_column("vms", sa.Column("os_version", sa.String(100), nullable=True))
    op.add_column("vms", sa.Column("business_owner", sa.String(255), nullable=True))
    op.add_column("vms", sa.Column("technical_owner", sa.String(255), nullable=True))
    op.add_column("vms", sa.Column("department", sa.String(255), nullable=True))
    op.add_column("vms", sa.Column("last_patch_date", sa.Date(), nullable=True))
    op.add_column("vms", sa.Column("last_vuln_scan_date", sa.Date(), nullable=True))
    op.add_column("vms", sa.Column("security_remarks", sa.Text(), nullable=True))
    op.add_column("vms", sa.Column("decommission_date", sa.Date(), nullable=True))

    op.create_index("ix_vms_environment", "vms", ["environment"])
    op.create_index("ix_vms_monitoring_enabled", "vms", ["monitoring_enabled"])

    # ── vm_disks ──────────────────────────────────────────────────────────────
    op.create_table(
        "vm_disks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vm_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("disk_name", sa.String(255), nullable=False),
        sa.Column("storage_name", sa.String(255), nullable=True),
        sa.Column("size_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_type", sa.String(100), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vm_id"], ["vms.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_vm_disks_vm_id", "vm_disks", ["vm_id"])

    # ── vm_networks ───────────────────────────────────────────────────────────
    op.create_table(
        "vm_networks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vm_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ip_address", sa.String(50), nullable=False),
        sa.Column("vlan", sa.Integer(), nullable=True),
        sa.Column("gateway", sa.String(50), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vm_id"], ["vms.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_vm_networks_vm_id", "vm_networks", ["vm_id"])

    # ── vm_applications ───────────────────────────────────────────────────────
    op.create_table(
        "vm_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vm_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("app_name", sa.String(255), nullable=False),
        sa.Column("app_owner", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vm_id"], ["vms.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("vm_id", "app_name", name="uq_vm_applications_vm_app"),
    )
    op.create_index("ix_vm_applications_vm_id", "vm_applications", ["vm_id"])

    # ── vm_attachments ────────────────────────────────────────────────────────
    op.create_table(
        "vm_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vm_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vm_id"], ["vms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
    )
    op.create_index("ix_vm_attachments_vm_id", "vm_attachments", ["vm_id"])

    # ── audit_log ─────────────────────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vm_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field_name", sa.String(100), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vm_id"], ["vms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_audit_log_vm_id_changed_at", "audit_log", ["vm_id", "changed_at"])

    # ── Data migration: ip_addresses JSONB → vm_networks rows ─────────────────
    op.execute("""
        INSERT INTO vm_networks (id, vm_id, ip_address, sort_order)
        SELECT
            gen_random_uuid(),
            v.id,
            ip_elem,
            (ordinality - 1)::integer
        FROM vms v,
             jsonb_array_elements_text(v.ip_addresses) WITH ORDINALITY AS t(ip_elem, ordinality)
        WHERE jsonb_array_length(v.ip_addresses) > 0
    """)

    # ── Data migration: disk_gb JSONB int-array → vm_disks rows ───────────────
    op.execute("""
        INSERT INTO vm_disks (id, vm_id, disk_name, size_gb, sort_order)
        SELECT
            gen_random_uuid(),
            v.id,
            'scsi' || (ordinality - 1)::text,
            (size_elem)::integer,
            (ordinality - 1)::integer
        FROM vms v,
             jsonb_array_elements_text(v.disk_gb) WITH ORDINALITY AS t(size_elem, ordinality)
        WHERE jsonb_array_length(v.disk_gb) > 0
    """)

    # ── Drop migrated JSONB columns ────────────────────────────────────────────
    op.drop_column("vms", "ip_addresses")
    op.drop_column("vms", "disk_gb")


def downgrade() -> None:
    bind = op.get_bind()

    # Reconstruct flat JSONB arrays from child tables before dropping them.
    op.add_column(
        "vms",
        sa.Column(
            "ip_addresses",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "vms",
        sa.Column(
            "disk_gb",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )
    op.execute("""
        UPDATE vms SET ip_addresses = sub.addrs
        FROM (
            SELECT vm_id, jsonb_agg(ip_address ORDER BY sort_order) AS addrs
            FROM vm_networks GROUP BY vm_id
        ) sub WHERE vms.id = sub.vm_id
    """)
    op.execute("""
        UPDATE vms SET disk_gb = sub.sizes
        FROM (
            SELECT vm_id, jsonb_agg(size_gb ORDER BY sort_order) AS sizes
            FROM vm_disks GROUP BY vm_id
        ) sub WHERE vms.id = sub.vm_id
    """)

    op.drop_table("audit_log")
    op.drop_table("vm_attachments")
    op.drop_table("vm_applications")
    op.drop_table("vm_networks")
    op.drop_table("vm_disks")

    op.drop_index("ix_vms_monitoring_enabled", table_name="vms")
    op.drop_index("ix_vms_environment", table_name="vms")

    op.drop_column("vms", "decommission_date")
    op.drop_column("vms", "security_remarks")
    op.drop_column("vms", "last_vuln_scan_date")
    op.drop_column("vms", "last_patch_date")
    op.drop_column("vms", "department")
    op.drop_column("vms", "technical_owner")
    op.drop_column("vms", "business_owner")
    op.drop_column("vms", "os_version")
    op.drop_column("vms", "os_distribution")
    op.drop_column("vms", "monitoring_enabled")
    op.drop_column("vms", "environment")
    op.drop_column("vms", "node")
    op.drop_column("vms", "fqdn")

    op.alter_column("vms", "description", new_column_name="notes")

    # Note: archived + decommissioned enum values cannot be removed without recreating the type.
    op.execute("ALTER TYPE vm_status RENAME VALUE 'powered_off' TO 'stopped'")

    environment_enum.drop(bind, checkfirst=True)
