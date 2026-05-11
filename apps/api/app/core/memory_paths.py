import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_PROFILE_ID = "default"
AI_NATIVE_OS_HOME_ENV = "AI_NATIVE_OS_HOME"


@dataclass(frozen=True)
class MemoryPaths:
    home: Path
    memory_root: Path
    profile_id: str
    profile_root: Path
    memory_file: Path
    dreams_file: Path
    readme_file: Path
    daily_dir: Path
    dreams_state_dir: Path
    backups_dir: Path
    migrations_dir: Path
    locks_dir: Path


def get_ai_native_home() -> Path:
    configured_home = os.getenv(AI_NATIVE_OS_HOME_ENV)
    if configured_home:
        return Path(configured_home)
    return Path.home() / ".ai-native-os"


def get_memory_root() -> Path:
    return get_ai_native_home() / "memory"


def slugify_profile_id(profile_id: str | None) -> str:
    if not profile_id:
        return DEFAULT_PROFILE_ID

    slug = "".join(
        character.lower() if character.isalnum() or character in "._-" else "_"
        for character in profile_id
    ).strip("._-")

    return slug or DEFAULT_PROFILE_ID


def get_profile_memory_root(profile_id: str | None = None) -> Path:
    memory_root = get_memory_root()
    profile_slug = slugify_profile_id(profile_id)
    if profile_slug == DEFAULT_PROFILE_ID:
        profile_root = memory_root
    else:
        profile_root = memory_root / "profiles" / profile_slug

    _assert_inside_memory_root(memory_root, profile_root)
    return profile_root


def ensure_memory_profile(profile_id: str | None = None) -> MemoryPaths:
    home = get_ai_native_home()
    memory_root = get_memory_root()
    profile_slug = slugify_profile_id(profile_id)
    profile_root = get_profile_memory_root(profile_slug)

    dreams_state_dir = profile_root / ".dreams"
    paths = MemoryPaths(
        home=home,
        memory_root=memory_root,
        profile_id=profile_slug,
        profile_root=profile_root,
        memory_file=profile_root / "MEMORY.md",
        dreams_file=profile_root / "DREAMS.md",
        readme_file=profile_root / "README.md",
        daily_dir=profile_root / "daily",
        dreams_state_dir=dreams_state_dir,
        backups_dir=dreams_state_dir / "backups",
        migrations_dir=dreams_state_dir / "migrations",
        locks_dir=dreams_state_dir / "locks",
    )

    for directory in (
        paths.profile_root,
        paths.daily_dir,
        paths.dreams_state_dir,
        paths.backups_dir,
        paths.migrations_dir,
        paths.locks_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    _write_template_if_missing(paths.memory_file, _memory_template(profile_slug))
    _write_template_if_missing(paths.dreams_file, _dreams_template(profile_slug))
    _write_template_if_missing(paths.readme_file, _readme_template(profile_slug))

    return paths


def _assert_inside_memory_root(memory_root: Path, profile_root: Path) -> None:
    resolved_memory_root = memory_root.resolve()
    resolved_profile_root = profile_root.resolve()

    if resolved_profile_root != resolved_memory_root and not resolved_profile_root.is_relative_to(
        resolved_memory_root
    ):
        raise ValueError("Profile memory root must be inside the memory root")


def _write_template_if_missing(path: Path, content: str) -> None:
    if not path.exists():
        path.write_text(content, encoding="utf-8")


def _memory_template(profile_id: str) -> str:
    return f"""# Memory

Profile: `{profile_id}`

长期记忆只保存稳定的事实、偏好和项目决定。请使用普通 Markdown bullet，
不要在这里记录临时对话、运行日志或内部元数据。

## 用户画像

## 用户偏好

## 项目与长期目标

## 事实与背景
"""


def _dreams_template(profile_id: str) -> str:
    return f"""# Dreams

Profile: `{profile_id}`

Use this file for dream, reflection, and consolidation notes.
"""


def _readme_template(profile_id: str) -> str:
    return f"""# AI-Native OS Memory Profile

Profile: `{profile_id}`

This directory contains local Markdown memory for AI-Native OS.
"""
