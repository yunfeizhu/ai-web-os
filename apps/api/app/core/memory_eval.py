"""Deterministic end-to-end checks for the local Markdown memory system."""

from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Iterator

from app.core.agent_harness import guard_tool_call
from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_flush import flush_memory_before_compaction
from app.core.memory_paths import AI_NATIVE_OS_HOME_ENV
from app.core.memory_transcripts import ingest_redacted_transcript


async def run_memory_eval(home: Path | str | None = None) -> dict[str, Any]:
    """Run memory checks in an isolated home directory.

    The eval intentionally avoids LLM calls and the process-wide memory manager.
    It only exercises deterministic local behavior, so it is safe to expose from
    the settings page without touching the user's real MEMORY.md.
    """
    if home is None:
        with tempfile.TemporaryDirectory(prefix="ai-native-memory-eval-") as temp_home:
            return await _run_eval_in_home(Path(temp_home))
    return await _run_eval_in_home(Path(home))


async def _run_eval_in_home(home: Path) -> dict[str, Any]:
    home.mkdir(parents=True, exist_ok=True)
    with _temporary_home(home):
        manager = MarkdownMemoryManager()
        scenarios = [
            await _scenario_long_term_recall(manager),
            await _scenario_daily_context(manager),
            _scenario_redaction_pipeline(manager),
            _scenario_tool_policy_boundary(),
        ]

    failed = [scenario for scenario in scenarios if scenario["status"] != "passed"]
    return {
        "status": "failed" if failed else "passed",
        "isolated": True,
        "memory_root": str(home / "memory"),
        "summary": {
            "passed": len(scenarios) - len(failed),
            "failed": len(failed),
            "total": len(scenarios),
        },
        "scenarios": scenarios,
    }


async def _scenario_long_term_recall(manager: MarkdownMemoryManager) -> dict[str, Any]:
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户偏好\n\n"
        "- 默认回复语言：中文\n"
    )
    results = await manager.search("preferred answer language", limit=3)
    matched = any(result.get("memory") == "默认回复语言：中文" for result in results)
    return _scenario_result(
        "long_term_recall",
        matched,
        {
            "matches": len(results),
            "top": results[0].get("memory") if results else "",
        },
        "长期记忆可被本地混合检索召回。",
    )


async def _scenario_daily_context(manager: MarkdownMemoryManager) -> dict[str, Any]:
    today = date.today().isoformat()
    daily_file = manager.paths.daily_dir / f"{today}.md"
    daily_file.write_text(
        f"# Daily Memory {today}\n\n"
        "## 今日上下文\n\n"
        "- 用户今天正在验证记忆系统。\n",
        encoding="utf-8",
    )

    context = await manager.recall_context("今天在做什么", limit=3)
    daily_notes = context.get("dailyNotes") or []
    prompt = str(context.get("prompt") or "")
    passed = bool(daily_notes) and "验证记忆系统" in prompt
    return _scenario_result(
        "daily_context",
        passed,
        {"dailyNotes": len(daily_notes)},
        "今日/昨日 daily notes 会自动进入召回上下文。",
    )


def _scenario_redaction_pipeline(manager: MarkdownMemoryManager) -> dict[str, Any]:
    flush_result = flush_memory_before_compaction(
        manager,
        [
            {"role": "user", "content": "请记住默认回复语言是中文，邮箱是 me@example.com"},
            {"role": "assistant", "content": "已记录。"},
        ],
    )
    transcript_result = ingest_redacted_transcript(
        manager,
        [
            {"role": "user", "content": "用户默认沟通语言是中文，OPENAI_API_KEY=sk-secret"},
            {"role": "assistant", "content": "了解。"},
        ],
    )
    combined = (
        Path(str(flush_result["path"])).read_text(encoding="utf-8")
        + "\n"
        + (manager.paths.dreams_state_dir / "transcripts.json").read_text(encoding="utf-8")
    )
    passed = (
        flush_result["staged"] == 1
        and transcript_result["ingested"] == 1
        and "me@example.com" not in combined
        and "sk-secret" not in combined
        and "[redacted-email]" in combined
        and "[redacted-secret]" in combined
    )
    return _scenario_result(
        "redaction_pipeline",
        passed,
        {
            "staged": flush_result["staged"],
            "transcripts": transcript_result["ingested"],
        },
        "压缩前刷新和 transcript 候选会先脱敏再落盘。",
    )


def _scenario_tool_policy_boundary() -> dict[str, Any]:
    write_memory = guard_tool_call(
        tool_name="write_file",
        args={"path": "/MEMORY.md", "content": "# Memory"},
        task_text="记住，我默认使用中文回复",
    )
    save_note = guard_tool_call(
        tool_name="save_note",
        args={"title": "Memory", "content": "默认使用中文回复"},
        task_text="记住，我默认使用中文回复",
    )
    passed = not write_memory.allowed and not save_note.allowed
    return _scenario_result(
        "tool_policy_boundary",
        passed,
        {
            "writeFileReason": write_memory.reason,
            "saveNoteReason": save_note.reason,
        },
        "记忆请求不会误走普通文件或笔记工具。",
    )


def _scenario_result(
    scenario_id: str,
    passed: bool,
    details: dict[str, Any],
    description: str,
) -> dict[str, Any]:
    return {
        "id": scenario_id,
        "status": "passed" if passed else "failed",
        "description": description,
        "details": details,
    }


@contextmanager
def _temporary_home(home: Path) -> Iterator[None]:
    previous = os.environ.get(AI_NATIVE_OS_HOME_ENV)
    os.environ[AI_NATIVE_OS_HOME_ENV] = str(home)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(AI_NATIVE_OS_HOME_ENV, None)
        else:
            os.environ[AI_NATIVE_OS_HOME_ENV] = previous
