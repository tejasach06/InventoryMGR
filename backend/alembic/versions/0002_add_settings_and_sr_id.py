"""Add dropdown settings, SR-ID, and multi-disk support.

Revision ID: 0002_add_settings_and_sr_id
Revises: 0001_initial
Create Date: 2026-06-23
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_add_settings_and_sr_id"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

dropdown_category = postgresql.ENUM(
    "cpu", "datacenter", "disk", "os", name="dropdown_category", create_type=False
)

SEED_OPTIONS: dict[str, list[str]] = {
    "cpu": ["2", "4", "6", "12"],
    "datacenter": ["Office", "IDC", "DC", "RD"],
    "disk": ["50", "100", "150"],
    "os": ["Linux", "Windows"],
}


def upgrade() -> None:
    bind = op.get_bind()

    # SR-ID column on vms.
    op.add_column("vms", sa.Column("sr_id", sa.String(length=50), nullable=True))

    # Convert disk_gb from scalar integer to a JSONB array of integers.
    op.drop_constraint("ck_vms_disk_gb_nonnegative", "vms", type_="check")
    op.alter_column(
        "vms",
        "disk_gb",
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=False,
        postgresql_using="to_jsonb(ARRAY[disk_gb])",
        server_default=None,
    )

    # Dropdown options table for configurable form selections.
    dropdown_category.create(bind, checkfirst=True)
    op.create_table(
        "dropdown_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", dropdown_category, nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category", "value", name="uq_dropdown_category_value"),
    )

    # Seed predefined options.
    options_table = sa.table(
        "dropdown_options",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("category", dropdown_category),
        sa.column("value", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4(),
            "category": category,
            "value": value,
            "created_at": now,
            "updated_at": now,
        }
        for category, values in SEED_OPTIONS.items()
        for value in values
    ]
    op.bulk_insert(options_table, rows)


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_table("dropdown_options")
    dropdown_category.drop(bind, checkfirst=True)

    # Restore disk_gb as a scalar integer (first array element, default 0).
    op.alter_column(
        "vms",
        "disk_gb",
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="COALESCE((disk_gb->>0)::integer, 0)",
    )
    op.create_check_constraint("ck_vms_disk_gb_nonnegative", "vms", "disk_gb >= 0")

    op.drop_column("vms", "sr_id")
