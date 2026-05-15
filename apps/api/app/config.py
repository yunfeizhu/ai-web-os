from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # 数据库
    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:15432/ainative"

    # Redis
    redis_url: str = "redis://127.0.0.1:16379/0"

    # MinIO
    minio_endpoint: str = "127.0.0.1:19000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "ainative-files"

    # Knowledge base
    knowledge_max_concurrent_jobs: int = 3

    # 应用
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    debug: bool = True
    browser_session_enabled: bool = True
    browser_runtime_url: str = "http://127.0.0.1:18100"
    python_exec_mode: str = "local"
    python_exec_docker_image: str = "python:3.11-slim"
    python_exec_timeout_sec: int = 5
    app_timezone: str = "Asia/Shanghai"

    # 安全
    secret_key: str = "change-me-in-production"

    # Human-in-the-loop: 需要用户确认才能执行的工具名称列表（逗号分隔）
    # 示例: CONFIRM_REQUIRED_TOOLS=python_exec,write_file
    confirm_required_tools: list[str] = []

    # 可观测性：Trace 后端（可选，不设置则禁用）
    # Arize Phoenix: 设置 TRACE_PHOENIX_ENDPOINT=http://localhost:6006/v1/traces
    trace_phoenix_endpoint: str = ""
    # LangSmith: 设置 TRACE_LANGSMITH_API_KEY=lsv2_...
    trace_langsmith_api_key: str = ""
    trace_langsmith_project: str = "ai-web-os"

    # QQ official Bot channel
    qqbot_enabled: bool = False
    qqbot_app_id: str = ""
    qqbot_app_secret: str = ""
    qqbot_bot_user_id: str = ""
    qqbot_account_id: str = "default"
    qqbot_allow_private: bool = True
    qqbot_allow_group: bool = False
    qqbot_allow_unlisted: bool = False
    qqbot_allowed_users: str = ""
    qqbot_allowed_groups: str = ""

    # Agent defaults used by external channels.
    qqbot_agent_user_id: str = "default"
    qqbot_agent_app_id: str = "ai-chat"
    qqbot_agent_model: str = "kimi-k2.5"
    qqbot_agent_provider_id: str = "moonshot"
    qqbot_agent_compat_type: str = "openai"
    qqbot_agent_api_key: str = ""
    qqbot_agent_api_base: str | None = None
    qqbot_agent_system_prompt: str = "你是 AI-Web OS 的智能助手，请简洁、友好地回答用户问题。"
    qqbot_enable_memory: bool = True

    model_config = {"env_file": "../../.env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
