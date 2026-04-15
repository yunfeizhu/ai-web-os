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

    # 安全
    secret_key: str = "change-me-in-production"

    model_config = {"env_file": "../../.env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
