"""LiteLLM 多模型统一接口"""
from __future__ import annotations

import json
from typing import AsyncIterator, Literal
import litellm
from litellm import acompletion

litellm.set_verbose = False

# provider id → LiteLLM 前缀
PROVIDER_PREFIX: dict[str, str] = {
    "anthropic":        "",          # claude-* 直接传，litellm 自动识别
    "openai":           "",          # gpt-* 直接传
    "google":           "gemini/",
    "deepseek":         "deepseek/",
    "qwen":             "openai/",   # OpenAI 兼容，需 api_base
    "zhipu":            "openai/",
    "moonshot":         "openai/",
    "doubao":           "openai/",
    "openai-compatible": "openai/",
}


def build_litellm_model(provider_id: str, model_id: str, compat_type: str = "openai") -> str:
    if provider_id in PROVIDER_PREFIX:
        prefix = PROVIDER_PREFIX[provider_id]
    elif compat_type == "anthropic":
        prefix = "anthropic/"
    else:
        # 自定义 OpenAI 兼容 Provider
        prefix = "openai/"
    return f"{prefix}{model_id}"


async def stream_chat(
    model: str,
    messages: list[dict],
    api_key: str,
    provider_id: str = "",
    compat_type: str = "openai",
    system_prompt: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_base: str | None = None,
) -> AsyncIterator[str]:
    """流式调用 LLM，逐 token yield。"""
    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(messages)

    if provider_id:
        litellm_model = build_litellm_model(provider_id, model, compat_type)
    else:
        if model.startswith("deepseek"):
            litellm_model = f"deepseek/{model}"
        elif model.startswith("gemini"):
            litellm_model = f"gemini/{model}"
        else:
            litellm_model = model

    kwargs: dict = dict(
        model=litellm_model,
        messages=full_messages,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    if api_base:
        kwargs["api_base"] = api_base

    response = await acompletion(**kwargs)

    async for chunk in response:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


# ── Agent Loop ────────────────────────────────────────────────────────────────

# 语义化事件类型：
#   ("token",       str)   — 一段文本 token
#   ("tool_call",   dict)  — {"id", "name", "args"}  完整工具调用
#   ("tool_result", dict)  — {"id", "name", "result", "error"}
AgentEvent = tuple[Literal["token", "tool_call", "tool_result"], str | dict]


async def agent_loop(
    model: str,
    messages: list[dict],
    api_key: str,
    provider_id: str = "",
    compat_type: str = "openai",
    system_prompt: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_base: str | None = None,
    tavily_key: str | None = None,
    max_iterations: int = 8,
) -> AsyncIterator[AgentEvent]:
    """Agent 工具调用循环，yield 语义化事件。

    Yields:
        ("token",       str)   — 文本 token，直接拼接即可
        ("tool_call",   dict)  — 完整工具调用 {id, name, args}
        ("tool_result", dict)  — 工具结果    {id, name, result, error}
    """
    from app.core.tools import execute_tool, get_tools_for_model

    if provider_id:
        litellm_model = build_litellm_model(provider_id, model, compat_type)
    else:
        if model.startswith("deepseek"):
            litellm_model = f"deepseek/{model}"
        elif model.startswith("gemini"):
            litellm_model = f"gemini/{model}"
        else:
            litellm_model = model

    tools = get_tools_for_model(model)

    full_messages: list[dict] = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(messages)

    base_kwargs: dict = dict(
        model=litellm_model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if api_base:
        base_kwargs["api_base"] = api_base

    for _ in range(max_iterations):
        call_kwargs: dict = {**base_kwargs, "messages": full_messages, "stream": True}
        if tools:
            call_kwargs["tools"] = tools
            call_kwargs["tool_choice"] = "auto"

        stream_resp = await acompletion(**call_kwargs)

        content_parts: list[str] = []
        tc_map: dict[int, dict] = {}   # index → {id, name, arguments}
        finish_reason: str | None = None

        async for raw_chunk in stream_resp:
            choice = raw_chunk.choices[0]
            delta = choice.delta

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            # 文本 token
            if delta.content:
                content_parts.append(delta.content)
                yield ("token", delta.content)

            # 聚合 tool_calls delta
            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tc_map:
                        tc_map[idx] = {"id": "", "name": "", "arguments": ""}
                    if tc_delta.id:
                        tc_map[idx]["id"] = tc_delta.id
                    if tc_delta.function:
                        if tc_delta.function.name:
                            tc_map[idx]["name"] += tc_delta.function.name
                        if tc_delta.function.arguments:
                            tc_map[idx]["arguments"] += tc_delta.function.arguments

        # 判断是否有工具调用（兼容不返回 finish_reason="tool_calls" 的 provider）
        has_tool_calls = bool(tc_map) and (
            finish_reason == "tool_calls" or finish_reason in ("stop", None)
        )

        if not has_tool_calls:
            return

        # 触发 tool_call 事件
        parsed_calls: list[dict] = []
        for tc in tc_map.values():
            try:
                args = json.loads(tc["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            parsed_calls.append({"id": tc["id"], "name": tc["name"], "args": args})
            yield ("tool_call", {"id": tc["id"], "name": tc["name"], "args": args})

        # 将 assistant 消息追加到历史
        full_messages.append({
            "role": "assistant",
            "content": "".join(content_parts),
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for tc in tc_map.values()
            ],
        })

        # 执行工具并 yield 结果
        for pc in parsed_calls:
            try:
                result = await execute_tool(pc["name"], pc["args"], tavily_key=tavily_key)
                error = False
            except Exception as e:
                result = f"工具执行异常: {e}"
                error = True

            yield ("tool_result", {"id": pc["id"], "name": pc["name"], "result": result, "error": error})

            full_messages.append({
                "role": "tool",
                "tool_call_id": pc["id"],
                "content": result,
            })

    # 超出最大迭代次数
    yield ("token", "\n\n（已达到最大工具调用次数）")
