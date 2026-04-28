import asyncio
import hashlib
import threading
from datetime import date
from pathlib import Path

from app.core.markdown_memory import MarkdownMemoryManager


def test_initialization_creates_templates_and_metadata(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    manager = MarkdownMemoryManager(profile_id="Research Agent")
    metadata = manager.metadata()

    assert metadata["backend"] == "markdown"
    assert metadata["collection"] == "markdown:research_agent"
    assert metadata["profile_id"] == "research_agent"
    assert metadata["initialized"] is True
    assert metadata["memory_root"] == str(home / "memory")
    profile_root = home / "memory" / "profiles" / "research_agent"
    assert metadata["memory_file"] == str(profile_root / "MEMORY.md")
    assert metadata["dreams_file"] == str(profile_root / "DREAMS.md")
    assert metadata["daily_dir"] == str(profile_root / "daily")
    assert (profile_root / "MEMORY.md").is_file()
    assert (profile_root / "DREAMS.md").is_file()


def test_get_all_parses_memory_bullets_with_explicit_and_derived_ids(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "- 用户喜欢安静模式 <!-- memory:id=quiet_mode; confidence=0.9 -->\n"
        "- 手动记录偏好蓝色\n"
    )

    records = asyncio.run(manager.get_all())

    manual_id = (
        "manual_"
        + hashlib.sha1("4:手动记录偏好蓝色".encode("utf-8")).hexdigest()[:12]
    )
    assert records == [
        {
            "id": "quiet_mode",
            "memory": "用户喜欢安静模式",
            "kind": "long_term",
            "sourcePath": str(home / "memory" / "MEMORY.md"),
            "line": 3,
            "confidence": 0.9,
        },
        {
            "id": manual_id,
            "memory": "手动记录偏好蓝色",
            "kind": "long_term",
            "sourcePath": str(home / "memory" / "MEMORY.md"),
            "line": 4,
        },
    ]


def test_add_async_writes_daily_candidate_once(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    messages = [
        {"role": "user", "content": "请记住我喜欢番茄钟"},
        {"role": "assistant", "content": "好的，我会记住。"},
    ]

    asyncio.run(manager.add_async("alice", messages))
    asyncio.run(manager.add_async("alice", messages))

    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"
    content = daily_file.read_text(encoding="utf-8")
    candidates = manager.list_candidates()

    assert content.count("请记住我喜欢番茄钟") == 1
    assert len(candidates) == 1
    assert candidates[0]["id"].startswith("cand_")
    assert candidates[0]["memory"] == "请记住我喜欢番茄钟"
    assert candidates[0]["kind"] == "candidate"
    assert candidates[0]["sourcePath"] == str(daily_file)
    assert candidates[0]["status"] == "pending"
    assert candidates[0]["line"] >= 1


def test_concurrent_add_async_preserves_different_daily_candidates(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager_a = MarkdownMemoryManager()
    manager_b = MarkdownMemoryManager()
    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"
    write_barrier = threading.Barrier(2)
    original_write_text = Path.write_text

    def racing_write_text(self, data, *args, **kwargs):
        if self == daily_file:
            write_barrier.wait(timeout=5)
        return original_write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", racing_write_text)

    async def add_from_thread(manager, user_text):
        await asyncio.to_thread(
            lambda: asyncio.run(
                manager.add_async(
                    "alice",
                    [
                        {"role": "user", "content": user_text},
                        {"role": "assistant", "content": "noted"},
                    ],
                )
            )
        )

    async def run_two_adds():
        await asyncio.gather(
            add_from_thread(manager_a, "Remember candidate alpha"),
            add_from_thread(manager_b, "Remember candidate beta"),
        )

    asyncio.run(run_two_adds())

    content = daily_file.read_text(encoding="utf-8")
    assert "Remember candidate alpha" in content
    assert "Remember candidate beta" in content


def test_add_async_inserts_candidate_before_next_daily_heading(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"
    daily_file.parent.mkdir(parents=True, exist_ok=True)
    daily_file.write_text(
        f"# Daily Memory - {today}\n\n"
        "## 候选记忆\n\n"
        "## 对话观察\n\n"
        "- 已有观察\n",
        encoding="utf-8",
    )

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢番茄钟"},
                {"role": "assistant", "content": "好的，我会记住。"},
            ],
        )
    )

    content = daily_file.read_text(encoding="utf-8")
    candidate_index = content.index("- 请记住我喜欢番茄钟")
    observations_heading_index = content.index("## 对话观察")
    existing_observation_index = content.index("- 已有观察")

    assert content.index("## 候选记忆") < candidate_index < observations_heading_index
    assert observations_heading_index < existing_observation_index


def test_add_async_preserves_unrelated_daily_sections_and_backs_up_existing_file(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"
    daily_file.parent.mkdir(parents=True, exist_ok=True)
    daily_file.write_text(
        f"# Daily Memory - {today}\n\n"
        "## 说明\n\n"
        "- 这是已有说明，不是候选记忆\n",
        encoding="utf-8",
    )

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢白噪音"},
                {"role": "assistant", "content": "好的，我会记住。"},
            ],
        )
    )

    content = daily_file.read_text(encoding="utf-8")
    backups = list((home / "memory" / ".dreams" / "backups").glob("daily-*.md"))

    assert "- 这是已有说明，不是候选记忆" in content
    assert "- 请记住我喜欢白噪音" in content
    assert backups
    assert any(
        "- 这是已有说明，不是候选记忆" in backup.read_text(encoding="utf-8")
        for backup in backups
    )


def test_search_returns_long_term_memories_and_candidates(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "- 用户偏好 Vim 键位 <!-- memory:id=vim_keys -->\n"
    )
    asyncio.run(
        manager.add_async(
            "default",
            [
                {"role": "user", "content": "以后提醒我喝水"},
                {"role": "assistant", "content": "没问题。"},
            ],
        )
    )

    long_term_results = asyncio.run(manager.search("Vim", limit=5))
    candidate_results = asyncio.run(manager.search("喝水", limit=5))

    assert long_term_results[0]["id"] == "vim_keys"
    assert long_term_results[0]["memory"] == "用户偏好 Vim 键位"
    assert long_term_results[0]["score"] > 0
    assert candidate_results[0]["kind"] == "candidate"
    assert candidate_results[0]["memory"] == "以后提醒我喝水"
    assert candidate_results[0]["score"] > 0


def test_delete_removes_matching_long_term_memory(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "- 保留这条 <!-- memory:id=keep -->\n"
        "- 删除这条 <!-- memory:id=remove_me -->\n"
    )

    asyncio.run(manager.delete("remove_me"))

    content = manager.read_memory_markdown()
    records = asyncio.run(manager.get_all())
    assert "删除这条" not in content
    assert [record["id"] for record in records] == ["keep"]


def test_delete_removes_only_one_duplicate_manual_memory(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "- 手写重复记忆\n"
        "- 手写重复记忆\n"
    )
    records = asyncio.run(manager.get_all())

    asyncio.run(manager.delete(records[0]["id"]))

    remaining_records = asyncio.run(manager.get_all())
    content = manager.read_memory_markdown()
    assert records[0]["id"] != records[1]["id"]
    assert content.count("手写重复记忆") == 1
    assert [record["memory"] for record in remaining_records] == ["手写重复记忆"]


def test_delete_all_backs_up_and_clears_long_term_memories(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "Profile: `default`\n\n"
        "Use this file for durable user and agent memory.\n"
        "- 待清空 <!-- memory:id=clear_me -->\n"
    )

    asyncio.run(manager.delete_all())

    records = asyncio.run(manager.get_all())
    content = manager.read_memory_markdown()
    backups = list((home / "memory" / ".dreams" / "backups").glob("MEMORY-*.md"))
    assert records == []
    assert "# Memory" in content
    assert "Profile: `default`" in content
    assert "待清空" not in content
    assert backups
    assert any("待清空" in backup.read_text(encoding="utf-8") for backup in backups)


def test_delete_all_preserves_plain_bullets_in_unknown_sections(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 操作说明\n\n"
        "- 这是任意说明，不是记忆\n\n"
        "## 用户偏好\n\n"
        "- 要删除 <!-- memory:id=remove_me -->\n"
    )

    asyncio.run(manager.delete_all())

    content = manager.read_memory_markdown()
    records = asyncio.run(manager.get_all())
    assert "要删除" not in content
    assert "这是任意说明，不是记忆" in content
    assert records == []


def test_get_all_only_parses_plain_bullets_in_memory_sections(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## Guardrails\n\n"
        "- 这是守卫说明，不是记忆\n\n"
        "## 用户偏好\n\n"
        "- 这是记忆\n"
    )

    records = asyncio.run(manager.get_all())

    assert [record["memory"] for record in records] == ["这是记忆"]
