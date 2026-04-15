from __future__ import annotations

import io
from functools import lru_cache
from threading import Lock

from minio import Minio
from minio.commonconfig import CopySource

from app.config import get_settings

_bucket_ready = False
_bucket_lock = Lock()


@lru_cache
def _minio_client() -> Minio:
    settings = get_settings()
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )


def ensure_bucket_exists() -> None:
    global _bucket_ready

    if _bucket_ready:
        return

    with _bucket_lock:
        if _bucket_ready:
            return

        settings = get_settings()
        client = _minio_client()
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
        _bucket_ready = True


def upload_object_bytes(
    storage_key: str,
    data: bytes,
    content_type: str | None = None,
) -> None:
    settings = get_settings()
    ensure_bucket_exists()
    client = _minio_client()
    put_kwargs = {"content_type": content_type} if content_type else {}
    client.put_object(
        settings.minio_bucket,
        storage_key,
        io.BytesIO(data),
        len(data),
        **put_kwargs,
    )


def download_object_bytes(storage_key: str) -> bytes:
    settings = get_settings()
    client = _minio_client()
    response = client.get_object(settings.minio_bucket, storage_key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def delete_object(storage_key: str) -> None:
    settings = get_settings()
    client = _minio_client()
    client.remove_object(settings.minio_bucket, storage_key)


def copy_object(source_key: str, target_key: str) -> None:
    settings = get_settings()
    ensure_bucket_exists()
    client = _minio_client()
    client.copy_object(
        settings.minio_bucket,
        target_key,
        CopySource(settings.minio_bucket, source_key),
    )