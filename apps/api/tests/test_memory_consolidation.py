import asyncio
import threading
from datetime import date
from pathlib import Path

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_consolidation import consolidate_memory


def test_explicit_candidate_is_promoted_to_user_preferences(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢番茄钟"},
                {"role": "assistant", "content": "好的，我会记住。"},
            ],
        )
    )

    result = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    dreams_content = manager.paths.dreams_file.read_text(encoding="utf-8")
    assert len(result.promoted) == 1
    assert result.skipped == []
    assert result.duplicate == []
    assert result.memory_path == str(manager.paths.memory_file)
    assert result.report_path == str(manager.paths.dreams_file)
    assert "## 用户偏好" in memory_content
    assert "- 请记住我喜欢番茄钟 <!-- memory:id=mem_" in memory_content
    assert f"source=daily/{date.today().isoformat()}.md" in memory_content
    assert f"## {date.today().isoformat()} 记忆整理" in dreams_content
    assert "### Light" in dreams_content
    assert "### REM" in dreams_content
    assert "### Deep" in dreams_content


def test_duplicate_candidate_is_not_promoted_twice(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢番茄钟"},
                {"role": "assistant", "content": "好的，我会记住。"},
            ],
        )
    )

    first = consolidate_memory(manager)
    second = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    assert len(first.promoted) == 1
    assert second.promoted == []
    assert second.skipped == []
    assert len(second.duplicate) == 1
    assert memory_content.count("请记住我喜欢番茄钟") == 1


def test_concurrent_consolidation_promotes_same_candidate_once(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住 concurrent consolidation preference"},
                {"role": "assistant", "content": "noted"},
            ],
        )
    )

    write_barrier = threading.Barrier(2)
    original_write_text = Path.write_text

    def racing_write_text(self, data, *args, **kwargs):
        if self == manager.paths.memory_file:
            write_barrier.wait(timeout=5)
        return original_write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", racing_write_text)

    async def run_two_consolidations():
        return await asyncio.gather(
            asyncio.to_thread(consolidate_memory, manager),
            asyncio.to_thread(consolidate_memory, manager),
        )

    first, second = asyncio.run(run_two_consolidations())

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    assert memory_content.count("concurrent consolidation preference") == 1
    assert len(first.promoted) + len(second.promoted) == 1


def test_plain_candidate_is_skipped_and_reported(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "今天下雨了"},
                {"role": "assistant", "content": "出门记得带伞。"},
            ],
        )
    )

    result = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    dreams_content = manager.paths.dreams_file.read_text(encoding="utf-8")
    assert result.promoted == []
    assert result.duplicate == []
    assert len(result.skipped) == 1
    assert "今天下雨了" not in memory_content
    assert "skipped" in dreams_content
    assert "今天下雨了" in dreams_content


def test_consolidation_creates_user_preferences_section_when_missing(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown("# Memory\n\n## 项目与长期目标\n\n- 保留项目目标\n")

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "以后提醒我喝水"},
                {"role": "assistant", "content": "没问题。"},
            ],
        )
    )

    result = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    assert len(result.promoted) == 1
    assert "## 项目与长期目标" in memory_content
    assert "- 保留项目目标" in memory_content
    assert "## 用户偏好" in memory_content
    assert "- 以后提醒我喝水 <!-- memory:id=mem_" in memory_content
