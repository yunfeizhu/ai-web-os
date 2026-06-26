import asyncio
from pathlib import Path

import pytest

from app.core import file_manager


def test_get_desktop_directory_uses_root_desktop_on_linux(monkeypatch):
    monkeypatch.setattr(file_manager, "IS_WINDOWS", False)

    assert file_manager.get_desktop_directory() == Path("/root/Desktop")


def test_get_desktop_directory_uses_user_desktop_on_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(file_manager, "IS_WINDOWS", True)

    assert file_manager.get_desktop_directory(home=tmp_path) == tmp_path / "Desktop"


def test_create_desktop_folder_creates_unique_folder_under_linux_desktop(
    monkeypatch,
    tmp_path,
):
    desktop_root = tmp_path / "real-desktop"
    existing = desktop_root / "新建文件夹"
    existing.mkdir(parents=True)
    monkeypatch.setattr(file_manager, "IS_WINDOWS", False)
    monkeypatch.setattr(file_manager, "LINUX_DESKTOP_ROOT", desktop_root)

    created = asyncio.run(file_manager.create_desktop_folder(db=None, name="新建文件夹"))

    assert (desktop_root / "新建文件夹 (1)").is_dir()
    assert created.name == "新建文件夹 (1)"
    assert created.path == "/root/Desktop/新建文件夹 (1)"


def test_save_binary_file_duplicate_path_uses_readable_conflict_message(monkeypatch, tmp_path):
    monkeypatch.setattr(file_manager, "IS_WINDOWS", False)
    monkeypatch.setattr(file_manager, "FS_ROOT", tmp_path)

    existing = tmp_path / "demo.bin"
    existing.write_bytes(b"existing")

    with pytest.raises(ValueError, match="同名文件或目录已存在。"):
        asyncio.run(
            file_manager.save_binary_file(
                db=None,
                path="/demo.bin",
                content=b"new",
                overwrite=False,
            )
        )
