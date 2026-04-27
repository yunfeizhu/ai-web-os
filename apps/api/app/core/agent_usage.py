from __future__ import annotations

from typing import Any

from app.core.context_manager import count_tokens


def _count_text_tokens(model: str, text: str) -> int:
    content = str(text or "")
    if not content:
        return 0
    return count_tokens(model, [{"role": "assistant", "content": content}])


def estimate_agent_usage(
    *,
    model: str,
    input_messages: list[dict[str, Any]],
    output_text: str,
    reasoning_text: str = "",
) -> dict[str, Any]:
    input_tokens = count_tokens(model, input_messages)
    output_tokens = _count_text_tokens(model, output_text)
    reasoning_tokens = _count_text_tokens(model, reasoning_text)
    total_tokens = input_tokens + output_tokens + reasoning_tokens

    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "reasoningTokens": reasoning_tokens,
        "totalTokens": total_tokens,
    }
