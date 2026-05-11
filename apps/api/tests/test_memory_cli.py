from datetime import date, timedelta

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_cli import run_memory_cli


def test_memory_cli_status_and_backfill_preview(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    old_day = date.today() - timedelta(days=3)
    daily_file = manager.paths.daily_dir / f"{old_day.isoformat()}.md"
    daily_file.write_text(
        f"# Daily Memory {old_day.isoformat()}\n\n"
        "## 候选记忆\n\n"
        "- 用户偏好中文回复 <!-- candidate:id=old_lang; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )

    status = run_memory_cli(["dreaming", "status"], manager)
    preview = run_memory_cli(["backfill", "preview"], manager)

    assert "Dreaming" in status
    assert "short-term" in status
    assert "用户偏好中文回复" in preview
