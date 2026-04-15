"""LiteLLM wrapper and agent loop."""

from __future__ import annotations

import json
from typing import AsyncIterator, Literal

import litellm
from litellm import acompletion

litellm.set_verbose = False

PROVIDER_PREFIX: dict[str, str] = {
    "anthropic": "",
    "openai": "",
    "google": "gemini/",
    "deepseek": "deepseek/",
    "qwen": "openai/",
    "zhipu": "openai/",
    "moonshot": "openai/",
    "doubao": "openai/",
    "openai-compatible": "openai/",
}

AgentEvent = tuple[Literal["token", "tool_call", "tool_result"], str | dict]


def build_litellm_model(provider_id: str, model_id: str, compat_type: str = "openai") -> str:
    if provider_id in PROVIDER_PREFIX:
        prefix = PROVIDER_PREFIX[provider_id]
    elif compat_type == "anthropic":
        prefix = "anthropic/"
    else:
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
    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(messages)

    if provider_id:
        litellm_model = build_litellm_model(provider_id, model, compat_type)
    elif model.startswith("deepseek"):
        litellm_model = f"deepseek/{model}"
    elif model.startswith("gemini"):
        litellm_model = f"gemini/{model}"
    else:
        litellm_model = model

    kwargs: dict = {
        "model": litellm_model,
        "messages": full_messages,
        "api_key": api_key,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if api_base:
        kwargs["api_base"] = api_base

    response = await acompletion(**kwargs)

    async for chunk in response:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


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
    max_iterations: int = 8,
) -> AsyncIterator[AgentEvent]:
    from app.core.tools import execute_tool, get_tool_display_name, get_tools_for_model

    if provider_id:
        litellm_model = build_litellm_model(provider_id, model, compat_type)
    elif model.startswith("deepseek"):
        litellm_model = f"deepseek/{model}"
    elif model.startswith("gemini"):
        litellm_model = f"gemini/{model}"
    else:
        litellm_model = model

    tools = await get_tools_for_model(model)

    full_messages: list[dict] = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(messages)

    base_kwargs: dict = {
        "model": litellm_model,
        "api_key": api_key,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if api_base:
        base_kwargs["api_base"] = api_base

    for _ in range(max_iterations):
        call_kwargs: dict = {**base_kwargs, "messages": full_messages, "stream": True}
        if tools:
            call_kwargs["tools"] = tools
            call_kwargs["tool_choice"] = "auto"

        stream_response = await acompletion(**call_kwargs)

        content_parts: list[str] = []
        tool_call_map: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None

        async for raw_chunk in stream_response:
            choice = raw_chunk.choices[0]
            delta = choice.delta

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            if delta.content:
                content_parts.append(delta.content)
                yield ("token", delta.content)

            if delta.tool_calls:
                for tool_delta in delta.tool_calls:
                    index = tool_delta.index
                    if index not in tool_call_map:
                        tool_call_map[index] = {"id": "", "name": "", "arguments": ""}
                    if tool_delta.id:
                        tool_call_map[index]["id"] = tool_delta.id
                    if tool_delta.function:
                        if tool_delta.function.name:
                            tool_call_map[index]["name"] += tool_delta.function.name
                        if tool_delta.function.arguments:
                            tool_call_map[index]["arguments"] += tool_delta.function.arguments

        has_tool_calls = bool(tool_call_map) and (
            finish_reason == "tool_calls" or finish_reason in ("stop", None)
        )
        if not has_tool_calls:
            return

        parsed_calls: list[dict] = []
        for tool_call in tool_call_map.values():
            try:
                args = json.loads(tool_call["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            parsed = {
                "id": tool_call["id"],
                "name": tool_call["name"],
                "displayName": await get_tool_display_name(tool_call["name"]),
                "args": args,
            }
            parsed_calls.append(parsed)
            yield ("tool_call", parsed)

        full_messages.append(
            {
                "role": "assistant",
                "content": "".join(content_parts),
                "tool_calls": [
                    {
                        "id": tool_call["id"],
                        "type": "function",
                        "function": {
                            "name": tool_call["name"],
                            "arguments": tool_call["arguments"],
                        },
                    }
                    for tool_call in tool_call_map.values()
                ],
            }
        )

        for parsed_call in parsed_calls:
            try:
                result = await execute_tool(
                    parsed_call["name"],
                    parsed_call["args"],
                )
                error = False
            except Exception as exc:
                result = f"工具执行异常: {exc}"
                error = True

            yield (
                "tool_result",
                {
                    "id": parsed_call["id"],
                    "name": parsed_call["name"],
                    "displayName": parsed_call.get("displayName"),
                    "result": result,
                    "error": error,
                },
            )

            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": parsed_call["id"],
                    "content": result,
                }
            )

    yield ("token", "\n\n（已达到最大工具调用次数）")
