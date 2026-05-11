import asyncio
import hashlib
import json
import threading
from datetime import date, timedelta
from pathlib import Path

from app.core.markdown_memory import MarkdownMemoryManager
from app.core import tools as tools_module


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


def test_normalize_memory_markdown_removes_inline_metadata_comments(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 职业：前端工程师 <!-- memory:id=job; source=qdrant:legacy -->\n"
    )

    changed = manager.normalize_memory_markdown()

    content = manager.read_memory_markdown()
    records = asyncio.run(manager.get_all())
    assert changed is True
    assert "<!--" not in content
    assert "source=qdrant" not in content
    assert "- 职业：前端工程师" in content
    assert records[0]["memory"] == "职业：前端工程师"


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


def test_add_async_records_implicit_recent_game_status(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "我最近在玩小丑牌（Balatro），非常上头"},
                {"role": "assistant", "content": "小丑牌确实很上头。"},
            ],
        )
    )

    candidates = manager.list_candidates()

    assert len(candidates) == 1
    assert candidates[0]["memory"] == "我最近在玩小丑牌（Balatro），非常上头"
    assert candidates[0]["kind"] == "candidate"
    assert candidates[0]["status"] == "pending"


def test_recall_context_uses_recent_implicit_game_candidate(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "我最近在玩小丑牌（Balatro），非常上头"},
                {"role": "assistant", "content": "小丑牌确实很上头。"},
            ],
        )
    )

    context = asyncio.run(manager.recall_context("我最近在玩什么游戏", limit=5))

    assert len(context["dailyNotes"]) == 1
    assert "小丑牌" in context["prompt"]
    assert "Balatro" in context["prompt"]


def test_recent_daily_context_loads_today_and_yesterday_only(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today()
    yesterday = today - timedelta(days=1)
    older = today - timedelta(days=2)

    for day, content in (
        (
            today,
            "# Daily Memory\n\n"
            "## 候选记忆\n\n"
            "- 今年五一准备去日本 "
            "<!-- candidate:id=today_trip; status=pending; user_id=alice -->\n",
        ),
        (
            yesterday,
            "# Daily Memory\n\n"
            "## 运行上下文\n\n"
            "- 昨天在排查 MCP 工具注入问题\n",
        ),
        (
            older,
            "# Daily Memory\n\n"
            "## 运行上下文\n\n"
            "- 前天的内容不应自动加载\n",
        ),
    ):
        path = manager.paths.daily_dir / f"{day.isoformat()}.md"
        path.write_text(content, encoding="utf-8")

    daily_notes = manager.list_recent_daily_context(today=today)

    assert [note["day"] for note in daily_notes] == [
        yesterday.isoformat(),
        today.isoformat(),
    ]
    assert "昨天在排查 MCP 工具注入问题" in daily_notes[0]["content"]
    assert "今年五一准备去日本" in daily_notes[1]["content"]
    assert "<!--" not in daily_notes[1]["content"]
    assert all("前天" not in note["content"] for note in daily_notes)


def test_recall_context_includes_daily_notes_without_query_match(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today()
    daily_file = manager.paths.daily_dir / f"{today.isoformat()}.md"
    daily_file.write_text(
        "# Daily Memory\n\n"
        "## 运行上下文\n\n"
        "- 用户今天正在调试记忆系统的 daily notes 加载\n",
        encoding="utf-8",
    )

    context = asyncio.run(manager.recall_context("查一下杭州天气", limit=5))

    assert context["recalled"] == []
    assert len(context["dailyNotes"]) == 1
    assert "daily notes 加载" in context["prompt"]
    assert "## 近期记忆上下文" in context["prompt"]


def test_recall_context_records_hashed_recall_trace(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 职业：前端工程师 <!-- memory:id=job -->\n"
    )

    asyncio.run(manager.recall_context("记得我是谁吗", limit=5))

    trace_path = manager.paths.dreams_state_dir / "recall-traces.json"
    payload = json.loads(trace_path.read_text(encoding="utf-8"))
    trace = payload["traces"][0]
    assert trace["queryHash"]
    assert "记得我是谁吗" not in trace_path.read_text(encoding="utf-8")
    assert trace["hitIds"] == ["job"]
    assert trace["dailyDays"] == []


def test_recall_context_deduplicates_candidates_already_in_daily_notes(
    monkeypatch,
    tmp_path,
):
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

    context = asyncio.run(manager.recall_context("番茄钟", limit=5))

    assert context["recalled"] == []
    assert context["prompt"].count("请记住我喜欢番茄钟") == 1


def test_memory_search_tool_returns_recall_context(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 职业：前端工程师\n"
    )
    monkeypatch.setattr(tools_module, "get_memory_manager", lambda: manager)

    result = asyncio.run(
        tools_module.execute_tool("memory_search", {"query": "记得我是谁吗"})
    )

    assert "职业：前端工程师" in result
    assert "recalled" in result


def test_memory_get_tool_supports_line_ranges(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n"
        "line 2\n"
        "line 3\n"
        "line 4\n"
    )
    monkeypatch.setattr(tools_module, "get_memory_manager", lambda: manager)

    result = asyncio.run(
        tools_module.execute_tool(
            "memory_get",
            {"kind": "memory", "start_line": 2, "end_line": 3},
        )
    )

    assert result == "line 2\nline 3"


def test_add_async_does_not_record_plain_query_as_candidate(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "查一下杭州今天的天气"},
                {"role": "assistant", "content": "杭州今天多云，适合出门。"},
            ],
        )
    )

    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"

    assert not daily_file.exists()
    assert manager.list_candidates() == []


def test_add_async_does_not_record_recent_game_question(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "我最近在玩什么游戏？"},
                {"role": "assistant", "content": "我需要查看记忆才能回答。"},
            ],
        )
    )

    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"

    assert not daily_file.exists()
    assert manager.list_candidates() == []


def test_add_async_does_not_record_recent_game_lookup_task(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "帮我查一下最近有什么游戏值得玩"},
                {"role": "assistant", "content": "可以，我来找一些推荐。"},
            ],
        )
    )

    today = date.today().isoformat()
    daily_file = home / "memory" / "daily" / f"{today}.md"

    assert not daily_file.exists()
    assert manager.list_candidates() == []


def test_add_async_records_followup_to_memory_clarification(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "记住，我几年五一去了日本"},
                {
                    "role": "assistant",
                    "content": "我需要确认一下具体年份，确认后可以帮您记录下来。",
                },
                {"role": "user", "content": "2026年五一准备去日本"},
                {"role": "assistant", "content": "好的，我会记住这个计划。"},
            ],
        )
    )

    candidates = manager.list_candidates()

    assert len(candidates) == 1
    assert candidates[0]["memory"] == "2026年五一准备去日本"


def test_list_candidates_ignores_legacy_conversation_transcript_lines(
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
        f"# Daily Memory {today}\n\n"
        "## 候选记忆\n\n"
        "- user: 查一下杭州天气 / assistant: 今天多云 "
        "<!-- candidate:id=old_chat; status=pending; user_id=default -->\n"
        "- 请记住我喜欢简洁回答 "
        "<!-- candidate:id=keep_this; status=pending; user_id=default -->\n",
        encoding="utf-8",
    )

    candidates = manager.list_candidates()

    assert [candidate["id"] for candidate in candidates] == ["keep_this"]
    assert candidates[0]["memory"] == "请记住我喜欢简洁回答"


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


def test_search_matches_chinese_sentence_queries_without_spaces(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 职业：前端工程师\n"
        "- 最近在玩《33号远征队》且已通关\n"
    )

    results = asyncio.run(manager.search("我最近在玩什么游戏", limit=3))

    assert "33号远征队" in results[0]["memory"]
    assert results[0]["score"] > 0


def test_search_recalls_profile_memories_for_identity_questions(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 最近在做一个 AI 桌面操作系统\n"
        "- 职业：前端工程师\n\n"
        "## 用户偏好\n\n"
        "- 用户偏好直接输出代码，不需要执行\n"
    )

    results = asyncio.run(manager.search("记得我是谁么", limit=5))

    result_memories = {result["memory"] for result in results}
    assert "最近在做一个 AI 桌面操作系统" in result_memories
    assert "职业：前端工程师" in result_memories
    assert all(result["score"] >= 0.45 for result in results)


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
