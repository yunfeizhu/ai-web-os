from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any


@dataclass(frozen=True)
class HandoffContext:
    active_agent: str
    messages: list[dict[str, Any]]
    dropped_tool_calls: int = 0
    dropped_tool_results: int = 0
    dropped_subagent_messages: int = 0


def normalize_active_agent(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text or text in {"main", "supervisor", "lead_agent"}:
        return "lead"
    return _slug(text)


def memory_user_id_for_agent(user_id: str, active_agent: str | None) -> str:
    base = str(user_id or "default").strip() or "default"
    agent = normalize_active_agent(active_agent)
    if agent == "lead":
        return base
    return f"{base}::agent:{agent}"


def build_handoff_context(
    history: list[Any],
    *,
    active_agent: str | None = "lead",
) -> HandoffContext:
    """Filter chat history for the current user-facing agent owner.

    The current product keeps Lead Agent as the only user-facing owner. Worker
    tool traces are useful for UI debugging but invalid as Lead chat history:
    OpenAI-compatible providers require assistant tool_calls and subsequent
    tool messages to be perfectly paired.
    """
    owner = normalize_active_agent(active_agent)
    messages = [message for message in history if isinstance(message, dict)]
    output: list[dict[str, Any]] = []
    dropped_tool_calls = 0
    dropped_tool_results = 0
    dropped_subagent_messages = 0
    consumed_tool_ids: set[str] = set()
    index = 0

    while index < len(messages):
        message = messages[index]
        role = str(message.get("role") or "").strip()

        if role in {"system", "user"}:
            output.append({"role": role, "content": str(message.get("content") or "")})
            index += 1
            continue

        if role == "assistant":
            content = message.get("content")
            assistant_content = content if isinstance(content, str) else None
            raw_calls = message.get("tool_calls")
            tool_calls = _normalize_tool_calls(raw_calls)
            if owner == "lead":
                lead_calls = [
                    call
                    for call in tool_calls
                    if not _is_subagent_tool_call(call)
                ]
                dropped_subagent_messages += len(tool_calls) - len(lead_calls)
                tool_calls = lead_calls

            if not tool_calls:
                if assistant_content and assistant_content.strip():
                    output.append({"role": "assistant", "content": assistant_content})
                index += 1
                continue

            expected_ids = {call["id"] for call in tool_calls}
            tool_results: list[dict[str, Any]] = []
            cursor = index + 1
            while cursor < len(messages) and str(messages[cursor].get("role") or "") == "tool":
                tool_message = messages[cursor]
                tool_call_id = str(tool_message.get("tool_call_id") or "").strip()
                if tool_call_id in expected_ids:
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": str(tool_message.get("content") or ""),
                    })
                    consumed_tool_ids.add(tool_call_id)
                else:
                    dropped_tool_results += 1
                    if _is_subagent_tool_id(tool_call_id):
                        dropped_subagent_messages += 1
                cursor += 1

            result_ids = {result["tool_call_id"] for result in tool_results}
            matched_calls = [call for call in tool_calls if call["id"] in result_ids]
            dropped_tool_calls += len(tool_calls) - len(matched_calls)
            if matched_calls:
                output.append({
                    "role": "assistant",
                    "content": assistant_content,
                    "tool_calls": matched_calls,
                })
                output.extend(
                    result for result in tool_results
                    if result["tool_call_id"] in result_ids
                )
            elif assistant_content and assistant_content.strip():
                output.append({"role": "assistant", "content": assistant_content})
            index = cursor
            continue

        if role == "tool":
            tool_call_id = str(message.get("tool_call_id") or "").strip()
            if tool_call_id not in consumed_tool_ids:
                dropped_tool_results += 1
                if _is_subagent_tool_id(tool_call_id):
                    dropped_subagent_messages += 1
            index += 1
            continue

        index += 1

    return HandoffContext(
        active_agent=owner,
        messages=output,
        dropped_tool_calls=dropped_tool_calls,
        dropped_tool_results=dropped_tool_results,
        dropped_subagent_messages=dropped_subagent_messages,
    )


def _normalize_tool_calls(raw_tool_calls: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_tool_calls, list):
        return []

    calls: list[dict[str, Any]] = []
    for raw_call in raw_tool_calls:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
        call_id = str(raw_call.get("id") or "").strip()
        name = str(function.get("name") or raw_call.get("name") or "").strip()
        if not call_id or not name:
            continue
        arguments = function.get("arguments")
        if arguments is None:
            arguments = raw_call.get("args")
        if isinstance(arguments, dict):
            arguments = json.dumps(arguments, ensure_ascii=False)
        elif not isinstance(arguments, str):
            arguments = "{}"
        call = {
            "id": call_id,
            "type": "function",
            "function": {"name": name, "arguments": arguments},
        }
        if raw_call.get("agentName") or raw_call.get("subagentId"):
            call["_subagent"] = True
        calls.append(call)
    return calls


def _is_subagent_tool_call(call: dict[str, Any]) -> bool:
    return bool(call.get("_subagent")) or _is_subagent_tool_id(str(call.get("id") or ""))


def _is_subagent_tool_id(value: str) -> bool:
    return "::" in str(value or "")


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9_\-]+", "_", str(value or "").lower()).strip("_-")
    return slug or "lead"
