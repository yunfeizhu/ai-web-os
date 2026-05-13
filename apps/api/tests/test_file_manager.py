import asyncio

import pytest

from app.core import file_manager


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
