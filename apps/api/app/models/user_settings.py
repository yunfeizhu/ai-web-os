from datetime import datetime, timezone
from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    # 单用户模式：固定 user_id = "default"
    user_id: Mapped[str] = mapped_column(String(128), primary_key=True, default="default")
    theme: Mapped[str] = mapped_column(String(32), default="light")
    language: Mapped[str] = mapped_column(String(16), default="zh-CN")
    # API Keys 加密后存储（阶段一先明文，后续加密）
    api_keys: Mapped[dict] = mapped_column(JSON, default=dict)
    default_model: Mapped[str] = mapped_column(
        String(128), default="claude-sonnet-4-6"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
