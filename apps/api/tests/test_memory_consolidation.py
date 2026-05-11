import asyncio
import json
import threading
from datetime import date, timedelta
from pathlib import Path

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_consolidation import (
    consolidate_memory,
    run_deep_phase,
    run_light_phase,
    run_rem_phase,
)


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
    assert result.promoted[0]["score"] >= 0.8
    assert "explicit_memory_intent" in result.promoted[0]["reasons"]
    assert result.skipped == []
    assert result.duplicate == []
    assert result.memory_path == str(manager.paths.memory_file)
    assert result.report_path == str(manager.paths.dreams_file)
    assert "## 用户偏好" in memory_content
    assert "- 请记住我喜欢番茄钟" in memory_content
    assert "<!-- memory:" not in memory_content
    assert f"source=daily/{date.today().isoformat()}.md" not in memory_content
    assert f"## {date.today().isoformat()} 记忆整理" in dreams_content
    assert "### Light" in dreams_content
    assert "### REM" in dreams_content
    assert "### Deep" in dreams_content
    assert "score=" in dreams_content
    assert "explicit_memory_intent" in dreams_content
    assert manager.list_candidates() == []
    assert "status=promoted" in (
        manager.paths.daily_dir / f"{date.today().isoformat()}.md"
    ).read_text(encoding="utf-8")


def test_record_intent_candidate_is_promoted(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "记录我的默认沟通语言是中文"},
                {"role": "assistant", "content": "已记录。"},
            ],
        )
    )

    result = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    assert len(result.promoted) == 1
    assert "记录我的默认沟通语言是中文" in memory_content


def test_consolidation_writes_dreaming_state_and_phase_signals(
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

    result = consolidate_memory(manager)

    short_term_path = manager.paths.dreams_state_dir / "short-term.json"
    signals_path = manager.paths.dreams_state_dir / "phase-signals.json"
    short_term = json.loads(short_term_path.read_text(encoding="utf-8"))
    signals = json.loads(signals_path.read_text(encoding="utf-8"))
    entry = next(iter(short_term["entries"].values()))
    assert result.state_path == str(short_term_path)
    assert result.phase_signal_path == str(signals_path)
    assert entry["text"] == "请记住我喜欢番茄钟"
    assert entry["status"] == "promoted"
    assert entry["score"] >= 0.8
    assert "explicit_memory_intent" in entry["reasons"]
    assert entry["sourcePaths"] == [str(manager.paths.daily_dir / f"{date.today().isoformat()}.md")]
    assert signals["light"]["candidates"] == 1
    assert signals["rem"]["summary"] == "请记住我喜欢番茄钟"
    assert signals["deep"]["promoted"] == 1


def test_dreaming_phases_can_run_individually_in_order(monkeypatch, tmp_path):
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

    light = run_light_phase(manager)
    rem = run_rem_phase(light)
    deep = run_deep_phase(manager, light, rem)

    assert light.candidate_count == 1
    assert rem.summary == "请记住我喜欢番茄钟"
    assert len(deep.promoted) == 1
    assert "请记住我喜欢番茄钟" in manager.read_memory_markdown()


def test_consolidation_carries_recall_traces_into_short_term_state(
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
                {"role": "user", "content": "以后提醒我喝水"},
                {"role": "assistant", "content": "没问题。"},
            ],
        )
    )
    asyncio.run(manager.recall_context("喝水", limit=5))

    consolidate_memory(manager)

    short_term = json.loads(
        (manager.paths.dreams_state_dir / "short-term.json").read_text(encoding="utf-8")
    )
    entry = next(iter(short_term["entries"].values()))
    assert entry["recallCount"] == 1
    assert len(entry["uniqueQueryHashes"]) == 1


def test_yesterday_candidate_is_promoted_from_recent_daily_notes(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    yesterday = date.today() - timedelta(days=1)
    daily_file = manager.paths.daily_dir / f"{yesterday.isoformat()}.md"
    daily_file.write_text(
        "# Daily Memory\n\n"
        "## 候选记忆\n\n"
        "- 请记住我今年五一准备去日本 "
        "<!-- candidate:id=yesterday_trip; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )

    result = consolidate_memory(manager)

    memory_content = manager.paths.memory_file.read_text(encoding="utf-8")
    assert len(result.promoted) == 1
    assert "请记住我今年五一准备去日本" in memory_content


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
    assert second.duplicate == []
    assert memory_content.count("请记住我喜欢番茄钟") == 1
    assert manager.list_candidates() == []


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


def test_plain_query_is_not_staged_for_consolidation(monkeypatch, tmp_path):
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
    assert result.skipped == []
    assert manager.list_candidates() == []
    assert "今天下雨了" not in memory_content
    assert "今天下雨了" not in dreams_content


def test_weak_manual_candidate_is_skipped_with_deep_score_reason(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today().isoformat()
    daily_file = manager.paths.daily_dir / f"{today}.md"
    daily_file.write_text(
        f"# Daily Memory {today}\n\n"
        "## 候选记忆\n\n"
        "- 只是一次临时天气对话 "
        "<!-- candidate:id=weak_weather; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )

    result = consolidate_memory(manager)

    assert result.promoted == []
    assert len(result.skipped) == 1
    assert result.skipped[0]["reason"] == "below_deep_threshold"
    assert result.skipped[0]["score"] < 0.8
    assert "below_min_score" in result.skipped[0]["reasons"]
    assert manager.list_candidates() == []


def test_non_explicit_recurrent_candidate_promotes_with_recall_diversity(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today()
    yesterday = today - timedelta(days=1)
    memory = "用户默认沟通语言是中文"
    today_file = manager.paths.daily_dir / f"{today.isoformat()}.md"
    yesterday_file = manager.paths.daily_dir / f"{yesterday.isoformat()}.md"
    today_file.write_text(
        f"# Daily Memory {today.isoformat()}\n\n"
        "## 候选记忆\n\n"
        f"- {memory} <!-- candidate:id=lang_today; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )
    yesterday_file.write_text(
        f"# Daily Memory {yesterday.isoformat()}\n\n"
        "## 候选记忆\n\n"
        f"- {memory} <!-- candidate:id=lang_yesterday; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )
    (manager.paths.dreams_state_dir / "recall-traces.json").write_text(
        json.dumps(
            {
                "version": 1,
                "traces": [
                    {"queryHash": "query_a", "hitIds": ["lang_today"], "dailyDays": []},
                    {"queryHash": "query_b", "hitIds": ["lang_yesterday"], "dailyDays": []},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = consolidate_memory(manager)

    memory_content = manager.read_memory_markdown()
    assert len(result.promoted) == 1
    assert memory in memory_content
    assert result.promoted[0]["score"] >= 0.8
    assert "recall_gate_passed:2" in result.promoted[0]["reasons"]
    assert "query_diversity_gate_passed:2" in result.promoted[0]["reasons"]
    assert "multi_day_recurrence:2" in result.promoted[0]["reasons"]


def test_recalled_candidate_without_query_diversity_is_skipped(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    today = date.today().isoformat()
    memory = "用户默认沟通语言是中文"
    daily_file = manager.paths.daily_dir / f"{today}.md"
    daily_file.write_text(
        f"# Daily Memory {today}\n\n"
        "## 候选记忆\n\n"
        f"- {memory} <!-- candidate:id=lang_only; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )
    (manager.paths.dreams_state_dir / "recall-traces.json").write_text(
        json.dumps(
            {
                "version": 1,
                "traces": [
                    {"queryHash": "same_query", "hitIds": ["lang_only"], "dailyDays": []},
                    {"queryHash": "same_query", "hitIds": ["lang_only"], "dailyDays": []},
                    {"queryHash": "same_query", "hitIds": ["lang_only"], "dailyDays": []},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = consolidate_memory(manager)

    assert result.promoted == []
    assert len(result.skipped) == 1
    assert result.skipped[0]["reason"] == "below_deep_threshold"
    assert "min_unique_queries_not_met:1<2" in result.skipped[0]["reasons"]
    assert memory not in manager.read_memory_markdown()


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
    assert "- 以后提醒我喝水" in memory_content
