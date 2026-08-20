"""normalize_ip_addresses

Revision ID: debd8a48a62e
Revises: 0023
Create Date: 2026-08-20 22:58:19.928108

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'debd8a48a62e'
down_revision: Union[str, Sequence[str], None] = '0023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "UPDATE vm_networks SET ip_address = btrim(split_part(btrim(ip_address), '/', 1)) "
        "WHERE ip_address <> btrim(split_part(btrim(ip_address), '/', 1))"
    )


def downgrade() -> None:
    """Downgrade schema."""
    pass
