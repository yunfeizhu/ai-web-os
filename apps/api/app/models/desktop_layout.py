from datetime import datetime, timezone
from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class DesktopLayout(Base):
    __tablename__ = "desktop_layouts"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True, default="default")
    icons: Mapped[list] = mapped_column(JSON, default=list)          # [{appId, x, y}]
    taskbar_pins: Mapped[list] = mapped_column(JSON, default=list)   # [appId, ...]
    wallpaper: Mapped[str] = mapped_column(String(512), default="")
    theme: Mapped[str] = mapped_column(String(32), default="light")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
