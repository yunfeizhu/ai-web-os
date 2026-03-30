from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # 数据库
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ainative"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # MinIO
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "ainative-files"

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
