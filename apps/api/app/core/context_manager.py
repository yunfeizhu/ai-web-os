"""Conversation context management: token budgeting, history truncation,
and tool-result summarisation.

Uses LiteLLM's built-in ``token_counter`` so no extra dependencies are needed.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from litellm import get_max_tokens, token_counter

logger = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────

# Fallback context window when LiteLLM cannot determine model limits.
_DEFAULT_CONTEXT_WINDOW = 128_000

# Maximum proportion of the context window that history may occupy.
_HISTORY_BUDGET_RATIO = 0.70

# When a single tool result exceeds this many characters, it will be
# summarised in *historical* turns (the current turn keeps the original).
_TOOL_RESULT_SUMMARY_THRESHOLD = 1500

# Sentinel appended to truncated tool results so the model sees the cut.
_TRUNCATION_MARKER = "\n\n…[结果已截断，仅保留关键部分]"

# Reminder injected right before the latest user message.
TOOL_USE_REMINDER = (
    "[系统提示] 如果本次请求需要获取实时数据或执行操作，并且存在名称、描述、参数都明显匹配的工具，"
    "请通过 function calling 调用对应工具；如果没有匹配工具，不要调用无关工具。"
    "禁止根据之前的对话历史仿写或编造工具返回结果。每次查询都可能返回不同数据。"
)

_ALLOWED_MESSAGE_ROLES = {"system", "user", "assistant", "tool", "function"}


# ── Public API ────────────────────────────────────────────────


def get_model_context_window(model: str) -> int:
    """Return the context window size for *model*, with a safe fallback."""
    try:
        max_tok = get_max_tokens(model)
        if max_tok and max_tok > 0:
            return int(max_tok)
    except Exception:
        pass
    return _DEFAULT_CONTEXT_WINDOW


def count_tokens(model: str, messages: list[dict]) -> int:
    """Count tokens for a message list using LiteLLM's tokeniser."""
    try:
        return token_counter(model=model, messages=messages)
    except Exception:
        # Rough fallback: ~4 chars per token for CJK-heavy content.
        total_chars = sum(len(str(m.get("content") or "")) for m in messages)
        return total_chars // 3


def prepare_messages(
    model: str,
    system_prompt: str,
    history: list[dict],
    max_output_tokens: int = 4096,
) -> list[dict]:
    """Build the final message list handed to the LLM.

    Strategy (applied in order):
    1. **Summarise old tool results** – Replace verbose tool outputs in
       historical turns with a short summary so the model cannot copy them.
    2. **Inject a tool-use reminder** – A short system-level reminder is
       placed right before the latest user message to reinforce that the
       model must actually call tools, not fabricate results.
    3. **Sliding-window truncation** – If the total token count still
       exceeds the budget, drop the *oldest* turns (keeping the system
       prompt and the most recent N turns intact).
    """

    context_window = get_model_context_window(model)

    # Token budget for system + history (reserve space for output).
    total_budget = context_window - max_output_tokens
    if total_budget < 2000:
        total_budget = 2000  # safety floor

    # -- Step 0: separate system prompt ---------------------------------
    sys_msg = {"role": "system", "content": system_prompt}
    sys_tokens = count_tokens(model, [sys_msg])

    history_budget = total_budget - sys_tokens
    if history_budget < 500:
        # System prompt alone is enormous; cannot do much.
        logger.warning("System prompt uses %d tokens, leaving only %d for history", sys_tokens, history_budget)
        history_budget = 500

    # -- Step 1: normalise externally supplied history ------------------
    processed = _sanitize_history_messages(history)

    # -- Step 2: summarise old tool results -----------------------------
    processed = _summarise_old_tool_results(processed)

    # -- Step 3: inject tool-use reminder -------------------------------
    processed = _inject_tool_reminder(processed)

    # -- Step 4: sliding-window truncation ------------------------------
    trimmed = _trim_history(model, processed, history_budget)

    return [sys_msg] + trimmed


# ── Internal helpers ──────────────────────────────────────────


def _sanitize_tool_calls(raw_tool_calls: Any) -> list[dict]:
    if not isinstance(raw_tool_calls, list):
        return []

    tool_calls: list[dict] = []
    for raw_call in raw_tool_calls:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function") or {}
        if not isinstance(function, dict):
            function = {}

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

        tool_calls.append({
            "id": call_id,
            "type": "function",
            "function": {
                "name": name,
                "arguments": arguments,
            },
        })
    return tool_calls


def _sanitize_history_messages(history: list[dict]) -> list[dict]:
    """Keep only provider-valid messages and preserve tool-call coherence."""
    messages = [msg for msg in history if isinstance(msg, dict)]
    sanitized: list[dict] = []
    i = 0

    while i < len(messages):
        msg = messages[i]
        role = str(msg.get("role") or "").strip()
        if role not in _ALLOWED_MESSAGE_ROLES:
            logger.warning("Dropping invalid chat history role: %r", role)
            i += 1
            continue

        if role in {"system", "user"}:
            content = str(msg.get("content") or "")
            if content.strip() or role == "system":
                sanitized.append({"role": role, "content": content})
            i += 1
            continue

        if role == "assistant":
            content = msg.get("content")
            assistant_content = content if isinstance(content, str) else None
            tool_calls = _sanitize_tool_calls(msg.get("tool_calls"))
            if not tool_calls:
                if assistant_content and assistant_content.strip():
                    sanitized.append({"role": "assistant", "content": assistant_content})
                i += 1
                continue

            expected_ids = {call["id"] for call in tool_calls}
            tool_results: list[dict] = []
            j = i + 1
            while j < len(messages) and str(messages[j].get("role") or "").strip() == "tool":
                tool_msg = messages[j]
                tool_call_id = str(tool_msg.get("tool_call_id") or "").strip()
                if tool_call_id in expected_ids:
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": str(tool_msg.get("content") or ""),
                    })
                j += 1

            result_ids = {tool_msg["tool_call_id"] for tool_msg in tool_results}
            matched_calls = [call for call in tool_calls if call["id"] in result_ids]
            if matched_calls:
                sanitized.append({
                    "role": "assistant",
                    "content": assistant_content,
                    "tool_calls": matched_calls,
                })
                sanitized.extend(tool_msg for tool_msg in tool_results if tool_msg["tool_call_id"] in result_ids)
            elif assistant_content and assistant_content.strip():
                sanitized.append({"role": "assistant", "content": assistant_content})

            i = j
            continue

        # Orphaned tool/function messages are invalid in OpenAI-compatible
        # payloads, so they are ignored instead of being passed through.
        i += 1

    return sanitized


def _summarise_old_tool_results(messages: list[dict]) -> list[dict]:
    """Replace long tool results in all turns *except the most recent
    assistant+tool exchange* with a compact summary.

    The most recent tool round is kept intact because the model needs
    full data to formulate its current answer.
    """
    if not messages:
        return messages

    # Find the index of the last user message – everything after it
    # belongs to the "current turn" and should be kept as-is.
    last_user_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_idx = i
            break

    result: list[dict] = []
    for i, msg in enumerate(messages):
        if i >= last_user_idx:
            # Current turn – keep original.
            result.append(msg)
            continue

        if msg.get("role") == "tool":
            content = str(msg.get("content") or "")
            if len(content) > _TOOL_RESULT_SUMMARY_THRESHOLD:
                result.append({
                    **msg,
                    "content": _truncate_tool_result(content),
                })
            else:
                result.append(msg)
        else:
            result.append(msg)

    return result


def _truncate_tool_result(content: str) -> str:
    """Keep the first portion of a tool result up to the threshold."""
    keep = _TOOL_RESULT_SUMMARY_THRESHOLD
    return content[:keep] + _TRUNCATION_MARKER


def _inject_tool_reminder(messages: list[dict]) -> list[dict]:
    """Insert a brief system reminder right before the last user message
    so it sits in the model's recency window.
    """
    if not messages:
        return messages

    last_user_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_idx = i
            break

    if last_user_idx < 0:
        return messages

    reminder = {"role": "system", "content": TOOL_USE_REMINDER}
    out = messages[:last_user_idx] + [reminder] + messages[last_user_idx:]
    return out


def _trim_history(
    model: str,
    messages: list[dict],
    budget_tokens: int,
) -> list[dict]:
    """Drop oldest messages until the history fits within *budget_tokens*.

    Preserves coherence rules:
    - Never orphan a ``tool`` message from its preceding ``assistant``
      that contains the matching ``tool_calls``.
    - Always keep the most recent user message and the reminder.
    """
    current_tokens = count_tokens(model, messages)
    if current_tokens <= budget_tokens:
        return messages

    # Group messages into logical "turns" that must stay together.
    groups = _group_turns(messages)

    # Drop from the front (oldest) until we fit.
    while len(groups) > 1 and current_tokens > budget_tokens:
        dropped = groups.pop(0)
        current_tokens = count_tokens(model, [m for g in groups for m in g])

    return [m for g in groups for m in g]


def _group_turns(messages: list[dict]) -> list[list[dict]]:
    """Group messages into indivisible turn blocks.

    A turn block is:
    - A single ``user`` or ``system`` message, OR
    - An ``assistant`` message followed by its ``tool`` result messages.
    """
    groups: list[list[dict]] = []
    current_group: list[dict] = []

    for msg in messages:
        role = msg.get("role")
        if role == "assistant":
            # Start a new group for assistant + upcoming tool results.
            if current_group:
                groups.append(current_group)
            current_group = [msg]
        elif role == "tool":
            # Attach to the current assistant group.
            current_group.append(msg)
        else:
            # user / system – standalone group.
            if current_group:
                groups.append(current_group)
            current_group = [msg]

    if current_group:
        groups.append(current_group)

    return groups
