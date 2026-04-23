from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


SCHEMA_PATCHES: dict[str, list[str]] = {
    "user_settings": [
        "ADD COLUMN IF NOT EXISTS theme VARCHAR(32) DEFAULT 'light'",
        "ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN'",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "desktop_layouts": [
        "ADD COLUMN IF NOT EXISTS icons JSON DEFAULT '[]'::json",
        "ADD COLUMN IF NOT EXISTS taskbar_pins JSON DEFAULT '[]'::json",
        "ADD COLUMN IF NOT EXISTS wallpaper VARCHAR(512) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS theme VARCHAR(32) DEFAULT 'light'",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "conversations": [
        "ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) DEFAULT 'default'",
        "ADD COLUMN IF NOT EXISTS app_id VARCHAR(128) DEFAULT 'ai-chat'",
        "ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT '新对话'",
        "ADD COLUMN IF NOT EXISTS model VARCHAR(128) DEFAULT 'claude-sonnet-4-6'",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "messages": [
        "ADD COLUMN IF NOT EXISTS content TEXT",
        "ADD COLUMN IF NOT EXISTS reasoning_content TEXT",
        "ADD COLUMN IF NOT EXISTS tool_calls JSON",
        "ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR(128)",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "knowledge_documents": [
        "ADD COLUMN IF NOT EXISTS source_url VARCHAR(512)",
        "ADD COLUMN IF NOT EXISTS raw_content TEXT",
        "ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'pending'",
        "ADD COLUMN IF NOT EXISTS error_msg TEXT",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "knowledge_chunks": [
        "ADD COLUMN IF NOT EXISTS qdrant_point_id VARCHAR(36)",
    ],
    "file_entries": [
        "ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) DEFAULT 'default'",
        "ADD COLUMN IF NOT EXISTS parent_path VARCHAR(1024) DEFAULT '/'",
        "ADD COLUMN IF NOT EXISTS kind VARCHAR(16) DEFAULT 'file'",
        "ADD COLUMN IF NOT EXISTS mime_type VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS size INTEGER DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS storage_key VARCHAR(1024)",
        "ADD COLUMN IF NOT EXISTS content_text TEXT",
        "ADD COLUMN IF NOT EXISTS extra JSON DEFAULT '{}'::json",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "apps": [
        "ADD COLUMN IF NOT EXISTS version VARCHAR(64) DEFAULT '0.1.0'",
        "ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'inactive'",
        "ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE",
        "ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT TRUE",
        "ADD COLUMN IF NOT EXISTS source_path VARCHAR(1024) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS manifest JSON DEFAULT '{}'::json",
        "ADD COLUMN IF NOT EXISTS settings JSON DEFAULT '{}'::json",
        "ADD COLUMN IF NOT EXISTS last_error TEXT",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "browser_sessions": [
        "ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'active'",
        "ADD COLUMN IF NOT EXISTS current_url VARCHAR(2048) DEFAULT 'about:blank'",
        "ADD COLUMN IF NOT EXISTS current_title VARCHAR(512) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS tab_count INTEGER DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS takeover_reason TEXT",
        "ADD COLUMN IF NOT EXISTS last_error TEXT",
        "ADD COLUMN IF NOT EXISTS action_log JSON DEFAULT '[]'::json",
        "ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "browser_login_profiles": [
        "ADD COLUMN IF NOT EXISTS label VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS site_url VARCHAR(2048) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS site_host VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS source_session_id VARCHAR(64)",
        "ADD COLUMN IF NOT EXISTS cookie_count INTEGER DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS storage_state JSON DEFAULT '{}'::json",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE",
    ],
    "calendar_events": [
        "ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS description TEXT",
        "ADD COLUMN IF NOT EXISTS location VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS start_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS end_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT FALSE",
        "ADD COLUMN IF NOT EXISTS color VARCHAR(32) DEFAULT '#2563eb'",
        "ADD COLUMN IF NOT EXISTS tags JSON DEFAULT '[]'::json",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "mail_accounts": [
        "ADD COLUMN IF NOT EXISTS label VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS imap_host VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS imap_port INTEGER DEFAULT 993",
        "ADD COLUMN IF NOT EXISTS imap_username VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS imap_password TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS imap_ssl BOOLEAN DEFAULT TRUE",
        "ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 465",
        "ADD COLUMN IF NOT EXISTS smtp_username VARCHAR(255) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS smtp_password TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS smtp_ssl BOOLEAN DEFAULT TRUE",
        "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
    "mail_messages": [
        "ADD COLUMN IF NOT EXISTS account_id VARCHAR(36) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS folder VARCHAR(128) DEFAULT 'INBOX'",
        "ADD COLUMN IF NOT EXISTS uid VARCHAR(128) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS message_id VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS subject VARCHAR(512) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS sender VARCHAR(512) DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS recipients TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE",
        "ADD COLUMN IF NOT EXISTS snippet TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS body_text TEXT DEFAULT ''",
        "ADD COLUMN IF NOT EXISTS body_html TEXT",
        "ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT FALSE",
        "ADD COLUMN IF NOT EXISTS metadata_json JSON DEFAULT '{}'::json",
        "ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    ],
}


def create_engine():
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_pre_ping=True,
    )


engine = create_engine()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def apply_development_schema_patches(conn) -> None:
    """Best-effort schema healing for local/dev databases.

    开发期大量直接演进 ORM 模型时，历史数据库常出现“表已存在但缺少新列”的情况。
    这里统一维护可重复执行的 ADD COLUMN IF NOT EXISTS 补丁，降低手动迁移成本。
    """
    for table_name, statements in SCHEMA_PATCHES.items():
        for statement in statements:
            await conn.execute(text(f"ALTER TABLE {table_name} {statement}"))


async def init_db():
    """Create all local tables used in development."""
    async with engine.begin() as conn:
        from app.models import (  # noqa: F401
            app,
            browser,
            calendar,
            conversation,
            desktop_layout,
            file_entry,
            knowledge,
            mail,
            user_settings,
        )

        await conn.run_sync(Base.metadata.create_all)
        await apply_development_schema_patches(conn)
