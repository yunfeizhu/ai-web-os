"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.String(128), primary_key=True),
        sa.Column("theme", sa.String(32), nullable=False, server_default="light"),
        sa.Column("language", sa.String(16), nullable=False, server_default="zh-CN"),
        sa.Column("api_keys", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("default_model", sa.String(128), nullable=False, server_default="claude-sonnet-4-6"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )

    op.create_table(
        "desktop_layouts",
        sa.Column("user_id", sa.String(128), primary_key=True),
        sa.Column("icons", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("taskbar_pins", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("wallpaper", sa.String(512), nullable=False, server_default=""),
        sa.Column("theme", sa.String(32), nullable=False, server_default="light"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("desktop_layouts")
    op.drop_table("user_settings")
