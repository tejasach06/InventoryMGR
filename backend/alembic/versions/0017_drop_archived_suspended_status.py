"""Drop archived/suspended from vm_status; migrate existing rows."""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE vms SET status = 'decommissioned' WHERE status = 'archived'")
    op.execute("UPDATE vms SET status = 'powered_off' WHERE status = 'suspended'")
    op.execute("ALTER TYPE vm_status RENAME TO vm_status_old")
    op.execute(
        "CREATE TYPE vm_status AS ENUM ('running', 'powered_off', 'decommissioned', 'unknown')"
    )
    op.execute(
        "ALTER TABLE vms ALTER COLUMN status TYPE vm_status USING status::text::vm_status"
    )
    op.execute("DROP TYPE vm_status_old")


def downgrade() -> None:
    # Row values are not restored: archived/suspended information is lost on upgrade.
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'suspended'")
    op.execute("ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived'")
