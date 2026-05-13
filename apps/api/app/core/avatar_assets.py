from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import quote

AVATAR_ASSETS_DIRNAME = "avatar"
AVATAR_UPLOAD_DIR = "live2d/uploads"


def get_user_config_dir() -> Path:
    return Path(
        os.getenv("AI_NATIVE_OS_HOME", str(Path.home() / ".ai-web-os"))
    ).expanduser()


def get_avatar_assets_root() -> Path:
    return get_user_config_dir() / AVATAR_ASSETS_DIRNAME


def resolve_avatar_asset_path(asset_path: str) -> Path:
    normalized = asset_path.replace("\\", "/").strip("/")
    parts = [part for part in normalized.split("/") if part]

    if not parts or any(part in {".", ".."} for part in parts):
        raise ValueError("Invalid avatar asset path")

    root = get_avatar_assets_root().resolve()
    target = (root.joinpath(*parts)).resolve()

    if target != root and root not in target.parents:
        raise ValueError("Invalid avatar asset path")

    return target


def sanitize_avatar_zip_name(filename: str | None) -> str:
    raw_name = Path(filename or "avatar-live2d.zip").name.strip()
    safe_name = re.sub(r"[^\w.\- ]+", "_", raw_name).strip(" .")

    if not safe_name:
        safe_name = "avatar-live2d.zip"
    if not safe_name.lower().endswith(".zip"):
        raise ValueError("Avatar model upload must be a .zip file")

    return safe_name


def build_avatar_asset_url(asset_path: str) -> str:
    parts = [quote(part) for part in asset_path.replace("\\", "/").strip("/").split("/") if part]
    return f"/avatar/assets/{'/'.join(parts)}"


def save_avatar_zip(filename: str | None, content: bytes) -> dict[str, str]:
    safe_name = sanitize_avatar_zip_name(filename)
    relative_path = f"{AVATAR_UPLOAD_DIR}/{safe_name}"
    target = resolve_avatar_asset_path(relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    return {
        "name": safe_name,
        "path": relative_path,
        "url": build_avatar_asset_url(relative_path),
    }
