"""LLM provider helpers and the tool-calling agent loop."""

from __future__ import annotations

import html
import json
import re
from typing import Any, AsyncIterator, Awaitable, Callable, Literal

import litellm
from litellm import acompletion

from app.core.agent_harness import (
    guard_tool_call,
    normalize_temporal_tool_args,
    policy_trace_payload,
    tool_call_signature,
    tool_requires_confirmation,
    validate_tool_result,
    validation_trace_payload,
)
from app.core.agent_graph import AgentGraphRuntime
from app.core.context_manager import (
    compact_history_if_needed,
    compact_tool_result_for_context,
    prepare_messages,
    render_messages_for_compaction,
)
from app.core.tool_capabilities import (
    CAPABILITY_SEARCH_DISCOVERY,
    WEB_CONTENT_CAPABILITIES,
    build_discovery_sufficient_tool_result,
    build_search_sufficient_tool_result,
    infer_tool_capability,
    normalize_extract_args,
    result_has_sufficient_discovery,
    should_skip_content_fetch_after_search,
    should_stop_search_after_sufficient_discovery,
    tool_schema_description,
    tool_schema_name,
)

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

AgentEvent = tuple[
    Literal[
        "token",
        "tool_call",
        "tool_result",
        "status",
        "reasoning_token",
        "subagent_token",
        "subagent_result",
    ],
    str | dict,
]

_MAX_TOOL_CALLS_WARNING = "\n\n\uff08\u5df2\u8fbe\u5230\u6700\u5927\u5de5\u5177\u8c03\u7528\u6b21\u6570\uff09"


def _is_safe_tool_preamble(text: str) -> bool:
    """Allow only a short non-substantive preface before tool calls."""
    compact = " ".join(str(text or "").split())
    if not compact:
        return False
    if len(compact) > 80:
        return False
    blocked_markers = ("|", "##", "如下", "根据", "数据来源", "总结", "建议", "℃", "%")
    return not any(marker in compact for marker in blocked_markers)


def _extract_hydrated_skill_ids(messages: list[dict]) -> set[str]:
    """Recover Skills selected earlier in the conversation.

    This keeps follow-up prompts such as "600519呢" connected to the Skill that
    was explicitly loaded in the previous turn, without exposing every Skill
    script to unrelated prompts.
    """
    skill_ids: set[str] = set()
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            function = call.get("function") or {}
            name = str(function.get("name") or call.get("name") or "").strip()
            if name == "load_skill_context":
                raw_args = function.get("arguments") or call.get("args") or {}
                args: dict = {}
                if isinstance(raw_args, str):
                    try:
                        args = json.loads(raw_args or "{}")
                    except json.JSONDecodeError:
                        args = {}
                elif isinstance(raw_args, dict):
                    args = raw_args
                skill_id = str(args.get("skill_id") or "").strip().lower()
                if skill_id:
                    skill_ids.add(skill_id)
            elif name.startswith("skill_"):
                skill_ids.add(name.lower())
    return skill_ids


def _tool_schema_names(tools: list[dict]) -> set[str]:
    names: set[str] = set()
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function") or {}
        if not isinstance(function, dict):
            continue
        name = str(function.get("name") or "").strip()
        if name:
            names.add(name)
    return names


def _normalize_text_tool_name(name: str, available_names: set[str]) -> str | None:
    raw = str(name or "").strip()
    if raw in available_names:
        return raw

    lowered = raw.lower()
    for available in available_names:
        if lowered == available.lower():
            return available

    # Some OpenAI-compatible providers occasionally emit plain-text tool markup
    # with a clipped tool name, e.g. "od_skill_context" for load_skill_context.
    if "load_skill_context" in available_names and "skill_context" in lowered:
        return "load_skill_context"

    return None


def _parse_text_tool_calls(text: str, tools: list[dict]) -> list[dict]:
    """Recover tool calls emitted as plain text by imperfect compatible APIs."""
    available_names = _tool_schema_names(tools)
    if not available_names:
        return []

    source = str(text or "")
    calls: list[dict] = []
    invoke_pattern = re.compile(
        r"<invoke\s+name=[\"'](?P<name>[^\"']+)[\"']\s*>(?P<body>.*?)</invoke>",
        re.I | re.S,
    )
    arg_pattern = re.compile(
        r"<(?:arg|parameter)\s+name=[\"'](?P<name>[^\"']+)[\"']\s*>(?P<value>.*?)</(?:arg|parameter)>",
        re.I | re.S,
    )

    for match in invoke_pattern.finditer(source):
        tool_name = _normalize_text_tool_name(match.group("name"), available_names)
        if not tool_name:
            continue
        args: dict[str, str] = {}
        for arg_match in arg_pattern.finditer(match.group("body")):
            arg_name = html.unescape(arg_match.group("name")).strip()
            arg_value = html.unescape(arg_match.group("value")).strip()
            if arg_name:
                args[arg_name] = arg_value
        calls.append({"name": tool_name, "args": args})

    return calls


def _strip_internal_model_markup(text: str) -> str:
    cleaned = str(text or "")
    cleaned = re.sub(r"<function_calls>.*?</function_calls>", "", cleaned, flags=re.I | re.S)
    cleaned = re.sub(r"<thinking>.*?</thinking>", "", cleaned, flags=re.I | re.S)
    cleaned = re.sub(r"</?(?:function_calls|thinking)[^>]*>", "", cleaned, flags=re.I)
    return cleaned.strip()


def _dump_delta(delta: object) -> dict[str, Any]:
    if isinstance(delta, dict):
        return delta
    model_dump = getattr(delta, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump(exclude_none=True)
        except TypeError:
            dumped = model_dump()
        if isinstance(dumped, dict):
            return dumped
    return {}


def _extract_delta_reasoning_content(delta: object) -> str:
    """Read provider reasoning tokens from LiteLLM stream deltas."""
    candidates: list[Any] = []
    for attr in ("reasoning_content", "reasoning", "reasoningContent"):
        candidates.append(getattr(delta, attr, None))

    data = _dump_delta(delta)
    candidates.extend(
        [
            data.get("reasoning_content"),
            data.get("reasoning"),
            data.get("reasoningContent"),
        ]
    )
    for nested_key in ("provider_specific_fields", "additional_kwargs"):
        nested = data.get(nested_key)
        if isinstance(nested, dict):
            candidates.extend(
                [
                    nested.get("reasoning_content"),
                    nested.get("reasoning"),
                    nested.get("reasoningContent"),
                ]
            )

    for value in candidates:
        if isinstance(value, str) and value:
            return value
    return ""


def _delegate_result_has_sufficient_search(result: str) -> bool:
    """Return True when a delegated research result already carries search evidence."""
    try:
        payload = json.loads(result or "{}")
    except Exception:
        return False
    if not isinstance(payload, dict):
        return False
    if payload.get("needsMoreTools") is True or payload.get("needs_more_tools") is True:
        return False

    caps = {
        str(item or "").strip()
        for item in (payload.get("capabilitiesUsed") or payload.get("capabilities_used") or [])
        if str(item or "").strip()
    }
    if (
        CAPABILITY_SEARCH_DISCOVERY in caps
        and payload.get("evidenceSufficient") is True
        and payload.get("needsMoreTools") is not True
    ):
        return True

    evidence_map = payload.get("evidence")
    if not isinstance(evidence_map, dict):
        return False
    for evidence in evidence_map.values():
        if not isinstance(evidence, dict):
            continue
        evidence_caps = {
            str(item or "").strip()
            for item in (evidence.get("capabilities_used") or evidence.get("capabilitiesUsed") or [])
            if str(item or "").strip()
        }
        if (
            CAPABILITY_SEARCH_DISCOVERY in evidence_caps
            and evidence.get("evidence_sufficient") is True
            and evidence.get("needs_more_tools") is not True
        ):
            return True
    return False


async def _summarize_history_for_compaction(
    messages: list[dict],
    *,
    litellm_model: str,
    api_key: str,
    api_base: str | None,
    max_tokens: int,
) -> str:
    """Use the active model to write a high-recall continuation summary."""
    transcript = render_messages_for_compaction(messages)
    prompt = (
        "You are compressing an AI assistant conversation so another model call "
        "can continue safely with less context.\n\n"
        "Write a concise but high-recall continuation summary. Preserve:\n"
        "- user goals, constraints, preferences, and explicit instructions\n"
        "- decisions already made and why they matter\n"
        "- current task state, open questions, blockers, and next steps\n"
        "- important file paths, app names, tool names, data sources, errors, and results\n"
        "- any facts that future answers must not contradict\n\n"
        "Discard repeated chatter, raw verbose tool payloads, and incidental wording. "
        "Do not invent facts. Prefer bullet sections with stable labels.\n\n"
        f"Conversation transcript to compress:\n{transcript}"
    )
    kwargs = build_litellm_completion_kwargs(
        litellm_model=litellm_model,
        api_key=api_key,
        temperature=0.1,
        max_tokens=min(1600, max(600, max_tokens // 2)),
        api_base=api_base,
    )
    kwargs["messages"] = [
        {
            "role": "system",
            "content": "You write faithful, loss-aware summaries for LLM context compaction.",
        },
        {"role": "user", "content": prompt},
    ]
    kwargs["timeout"] = 45

    response = await acompletion(**kwargs)
    try:
        content = response.choices[0].message.content
    except Exception:
        content = ""
    return str(content or "").strip()


def build_litellm_model(provider_id: str, model_id: str, compat_type: str = "openai") -> str:
    if provider_id in PROVIDER_PREFIX:
        prefix = PROVIDER_PREFIX[provider_id]
    elif compat_type == "anthropic":
        prefix = "anthropic/"
    else:
        prefix = "openai/"
    return f"{prefix}{model_id}"


def _model_uses_fixed_sampling_params(litellm_model: str) -> bool:
    """Return True when provider rejects caller-supplied sampling params."""
    model_id = str(litellm_model or "").split("/")[-1].lower()
    return model_id.startswith("kimi-k2")


def _model_uses_reasoning_content(litellm_model: str) -> bool:
    model_id = str(litellm_model or "").split("/")[-1].lower()
    return model_id.startswith("kimi-k2")


def build_litellm_completion_kwargs(
    *,
    litellm_model: str,
    api_key: str,
    temperature: float,
    max_tokens: int,
    api_base: str | None = None,
    stream: bool | None = None,
) -> dict:
    """Build LiteLLM kwargs with provider-specific compatibility handling."""
    kwargs: dict = {
        "model": litellm_model,
        "api_key": api_key,
        "max_tokens": max_tokens,
    }
    if not _model_uses_fixed_sampling_params(litellm_model):
        kwargs["temperature"] = temperature
    if api_base:
        kwargs["api_base"] = api_base
    if stream is not None:
        kwargs["stream"] = stream
    return kwargs


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

    kwargs = build_litellm_completion_kwargs(
        litellm_model=litellm_model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
        api_base=api_base,
        stream=True,
    )
    kwargs["messages"] = full_messages

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
    skill_context: dict | None = None,
    request_id: str | None = None,
    confirm_callback: "Callable[[str, dict], Awaitable[bool]] | None" = None,
    confirm_tools: "frozenset[str] | None" = None,
) -> AsyncIterator[AgentEvent]:
    """Clean ReAct agent loop — no regex ToolScope routing.

    Follows the OpenAI/Anthropic tool-calling paradigm:
    - Available tools are exposed together; descriptions guide the LLM.
    - Tokens are always streamed (speculative streaming), no post-tool buffering.
    - No deterministic fallback state machine; validation failures are fed back
      as tool/system messages so the model can correct itself in the next turn.
    - MCP routes use a 30-second TTL cache.
    """
    from app.core.tools import (
        execute_tool,
        get_tool_display_name,
        get_tools_for_model,
    )
    from app.core.agent_types import build_supervisor_prompt
    from app.core.subagent import (
        DELEGATE_TOOL_CONTEXT_CHARS,
        build_subagent_tool_result,
        run_subagents_parallel,
    )

    if provider_id:
        litellm_model = build_litellm_model(provider_id, model, compat_type)
    elif model.startswith("deepseek"):
        litellm_model = f"deepseek/{model}"
    elif model.startswith("gemini"):
        litellm_model = f"gemini/{model}"
    else:
        litellm_model = model

    user_message = ""
    if messages and isinstance(messages[-1], dict):
        user_message = str(messages[-1].get("content") or "")

    executed_tool_signatures: set[str] = set()
    loaded_skill_guides: set[str] = set()
    ctx = skill_context or {}
    agent_depth = int(ctx.get("agent_depth", 0))
    agent_mode = str(ctx.get("agent_mode") or "auto").lower()
    is_subagent = bool(ctx.get("is_subagent")) or agent_depth > 0
    tools = await get_tools_for_model(
        model,
        user_message=user_message,
        skill_context=skill_context,
    )
    tool_capability_by_name: dict[str, str | None] = {}
    tool_description_by_name: dict[str, str] = {}
    for tool in tools:
        name = tool_schema_name(tool)
        if not name:
            continue
        function = tool.get("function") or {}
        parameters = function.get("parameters") if isinstance(function, dict) else None
        description = tool_schema_description(tool)
        tool_description_by_name[name] = description
        tool_capability_by_name[name] = infer_tool_capability(name, description, parameters)
    successful_search_count = 0

    effective_system_prompt = system_prompt or ""
    if not is_subagent and agent_mode != "single":
        effective_system_prompt = (
            f"{effective_system_prompt}\n\n{build_supervisor_prompt(agent_mode)}"
            if effective_system_prompt
            else build_supervisor_prompt(agent_mode)
        )

    base_kwargs = build_litellm_completion_kwargs(
        litellm_model=litellm_model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
        api_base=api_base,
    )

    graph = AgentGraphRuntime(request_id=request_id)
    yield ("status", graph.status("build_context"))

    async def _summarizer(old_messages: list[dict]) -> str:
        return await _summarize_history_for_compaction(
            old_messages,
            litellm_model=litellm_model,
            api_key=api_key,
            api_base=api_base,
            max_tokens=max_tokens,
        )

    compaction = await compact_history_if_needed(
        model=litellm_model,
        history=messages,
        max_output_tokens=max_tokens,
        summarizer=_summarizer,
    )
    if compaction.compacted:
        yield (
            "status",
            {
                "status": "context_compacted",
                "beforeTokens": compaction.before_tokens,
                "afterTokens": compaction.after_tokens,
                "summaryTokens": compaction.summary_tokens,
                "oldMessageCount": compaction.old_message_count,
                "keptMessageCount": compaction.kept_message_count,
            },
        )

    full_messages = prepare_messages(
        model=litellm_model,
        system_prompt=effective_system_prompt,
        history=compaction.messages,
        max_output_tokens=max_tokens,
    )

    for iteration in range(max_iterations):
        yield ("status", graph.status("llm_decide"))

        call_kwargs: dict = {**base_kwargs, "messages": full_messages, "stream": True}
        if tools:
            call_kwargs["tools"] = tools
            call_kwargs["tool_choice"] = "auto"

        stream_response = await acompletion(**call_kwargs)

        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_call_map: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None

        async for raw_chunk in stream_response:
            choice = raw_chunk.choices[0]
            delta = choice.delta

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            reasoning_token = _extract_delta_reasoning_content(delta)
            if reasoning_token:
                reasoning_parts.append(reasoning_token)
                yield ("reasoning_token", reasoning_token)

            # Always stream tokens — speculative streaming
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

        # Try to recover plain-text tool calls from providers that don't support
        # native function calling properly
        if tools and not tool_call_map:
            text_calls = _parse_text_tool_calls("".join(content_parts), tools)
            for index, text_call in enumerate(text_calls):
                tool_call_map[index] = {
                    "id": f"call_text_{iteration}_{index}",
                    "name": text_call["name"],
                    "arguments": json.dumps(text_call["args"], ensure_ascii=False),
                }
            if text_calls:
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        status="tool_policy",
                        decision="normalized",
                        reason="plain_text_tool_call",
                        hint="模型把工具调用输出成了文本，已转换为标准工具调用。",
                    ),
                )

        has_tool_calls = bool(tool_call_map) and (
            finish_reason == "tool_calls" or finish_reason in ("stop", None)
        )
        if not has_tool_calls:
            # Model decided not to call any tools — final answer already streamed
            yield ("status", graph.status("respond"))
            return

        # ── Parse and deduplicate tool calls ──────────────────────────────────
        parsed_calls: list[dict] = []
        for tool_call in tool_call_map.values():
            try:
                args = json.loads(tool_call["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            args = normalize_temporal_tool_args(
                tool_name=tool_call["name"],
                args=args,
                user_message=user_message,
            )
            if tool_capability_by_name.get(tool_call["name"]) in WEB_CONTENT_CAPABILITIES:
                args = normalize_extract_args(args)

            display_name = await get_tool_display_name(tool_call["name"])
            parsed_calls.append({
                "id": tool_call["id"],
                "name": tool_call["name"],
                "displayName": display_name,
                "args": args,
            })

        filtered_calls: list[dict] = []
        for parsed in parsed_calls:
            signature = tool_call_signature(parsed["name"], parsed["args"])
            if signature and signature in executed_tool_signatures:
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        status="tool_policy",
                        tool=parsed["name"],
                        decision="rejected",
                        reason="duplicate_tool_call",
                        hint="已阻止重复工具调用，请基于已有工具结果回答，不要再次调用相同查询。",
                        args=parsed["args"],
                    ),
                )
                full_messages.append({
                    "role": "system",
                    "content": (
                        "ToolPolicyGuard: 已阻止重复工具调用。"
                        "请基于已有工具结果回答；如果结果不足，请明确说明不确定性，不要重复调用相同查询。"
                    ),
                })
                continue
            filtered_calls.append(parsed)

        parsed_calls = filtered_calls
        if not parsed_calls:
            # All calls were duplicates — ask the model to answer from existing results
            full_messages.append({"role": "system", "content": "请根据已有工具结果给出最终回答。"})
            continue

        for parsed in parsed_calls:
            yield ("tool_call", parsed)

        assistant_tool_message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": parsed_call["id"],
                    "type": "function",
                    "function": {
                        "name": parsed_call["name"],
                        "arguments": json.dumps(parsed_call["args"], ensure_ascii=False),
                    },
                }
                for parsed_call in parsed_calls
            ],
        }
        if reasoning_parts or _model_uses_reasoning_content(litellm_model):
            assistant_tool_message["reasoning_content"] = "".join(reasoning_parts)
        full_messages.append(assistant_tool_message)

        # ── Execute each tool call ─────────────────────────────────────────────
        for parsed_call in parsed_calls:
            # ── delegate_task: spawn parallel Sub-Agents ──────────────────────
            if parsed_call["name"] == "delegate_task":
                specs = parsed_call["args"].get("tasks", [])
                subagent_result_payloads: list[dict] = []
                yield (
                    "status",
                    graph.status(
                        "execute_tool",
                        tool=parsed_call["name"],
                        status="multi_agent_dispatch",
                        agentMode="manager_subagents",
                        taskCount=len(specs) if isinstance(specs, list) else 0,
                    ),
                )
                async for sa_type, sa_payload in run_subagents_parallel(
                    specs,
                    model=model,
                    api_key=api_key,
                    provider_id=provider_id,
                    compat_type=compat_type,
                    api_base=api_base,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    max_iterations=max_iterations,
                    skill_context=skill_context,
                    request_id=request_id,
                ):
                    yield (sa_type, sa_payload)
                    if sa_type == "subagent_result" and isinstance(sa_payload, dict):
                        subagent_result_payloads.append(sa_payload)

                result = build_subagent_tool_result(subagent_result_payloads) if subagent_result_payloads else '{"results": {}}'
                if _delegate_result_has_sufficient_search(result):
                    successful_search_count += 1
                context_result = compact_tool_result_for_context(
                    tool_name=parsed_call["name"],
                    result=result,
                    is_subagent=False,
                    max_chars=DELEGATE_TOOL_CONTEXT_CHARS,
                )

                yield (
                    "tool_result",
                    {
                        "id": parsed_call["id"],
                        "name": parsed_call["name"],
                        "displayName": parsed_call.get("displayName") or "多 Agent 委托",
                        "result": result,
                        "error": False,
                    },
                )
                full_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": parsed_call["id"],
                        "content": context_result,
                    }
                )
                continue

            if should_stop_search_after_sufficient_discovery(
                tool_name=parsed_call["name"],
                description=tool_description_by_name.get(parsed_call["name"]),
                args=parsed_call["args"],
                task_text=user_message,
                successful_search_count=successful_search_count,
                is_subagent=is_subagent,
            ):
                result = build_discovery_sufficient_tool_result(successful_search_count)
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        status="tool_policy",
                        tool=parsed_call["name"],
                        decision="skipped",
                        reason="search_results_sufficient",
                        hint=(
                            "A discovery/search result already covers this sub-task; "
                            "stop searching and answer from existing evidence."
                        ),
                        args=parsed_call["args"],
                    ),
                )
                yield (
                    "tool_result",
                    {
                        "id": parsed_call["id"],
                        "name": parsed_call["name"],
                        "displayName": parsed_call.get("displayName"),
                        "result": result,
                        "error": False,
                    },
                )
                full_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": parsed_call["id"],
                        "content": result,
                    }
                )
                full_messages.append({
                    "role": "system",
                    "content": "请基于已有搜索结果给出最终回答，不要继续调用搜索工具。",
                })
                continue

            if should_skip_content_fetch_after_search(
                tool_name=parsed_call["name"],
                description=tool_description_by_name.get(parsed_call["name"]),
                args=parsed_call["args"],
                task_text=user_message,
                successful_search_count=successful_search_count,
            ):
                result = build_search_sufficient_tool_result(successful_search_count)
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        status="tool_policy",
                        tool=parsed_call["name"],
                        decision="skipped",
                        reason="search_results_sufficient",
                        hint=(
                            "A discovery/search result is already available; "
                            "skip full-page extraction unless exact source text is needed."
                        ),
                        args=parsed_call["args"],
                    ),
                )
                yield (
                    "tool_result",
                    {
                        "id": parsed_call["id"],
                        "name": parsed_call["name"],
                        "displayName": parsed_call.get("displayName"),
                        "result": result,
                        "error": False,
                    },
                )
                full_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": parsed_call["id"],
                        "content": result,
                    }
                )
                continue

            decision = guard_tool_call(
                tool_name=parsed_call["name"],
                args=parsed_call["args"],
            )
            if not decision.allowed:
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        **policy_trace_payload(
                            tool_name=parsed_call["name"],
                            args=parsed_call["args"],
                            decision=decision,
                        ),
                    ),
                )
                result = (
                    f"工具调用被策略拦截: {decision.reason}。"
                    f"{decision.replacement_hint}"
                )
                error = True
            elif (
                confirm_callback is not None
                and tool_requires_confirmation(
                    parsed_call["name"], parsed_call["args"], extra_tools=confirm_tools
                )
            ):
                # Human-in-the-loop: pause and ask for user confirmation
                yield (
                    "status",
                    graph.status(
                        "policy_guard",
                        status="confirm_required",
                        tool=parsed_call["name"],
                        args=parsed_call["args"],
                    ),
                )
                try:
                    approved = await confirm_callback(parsed_call["name"], parsed_call["args"])
                except Exception:
                    approved = False
                if not approved:
                    result = "用户已拒绝该操作，跳过执行。"
                    error = False
                    yield (
                        "status",
                        graph.status(
                            "policy_guard",
                            status="confirm_rejected",
                            tool=parsed_call["name"],
                        ),
                    )
                else:
                    yield (
                        "status",
                        graph.status("execute_tool", tool=parsed_call["name"]),
                    )
                    try:
                        signature = tool_call_signature(parsed_call["name"], parsed_call["args"])
                        if signature:
                            executed_tool_signatures.add(signature)
                        result = await execute_tool(
                            parsed_call["name"], parsed_call["args"], loaded_skill_guides
                        )
                        error = False
                    except Exception as exc:
                        detail = str(exc).strip() or repr(exc) or type(exc).__name__
                        result = f"工具执行异常: {type(exc).__name__}: {detail}"
                        error = True
            else:
                yield (
                    "status",
                    graph.status("execute_tool", tool=parsed_call["name"]),
                )
                try:
                    signature = tool_call_signature(parsed_call["name"], parsed_call["args"])
                    if signature:
                        executed_tool_signatures.add(signature)
                    result = await execute_tool(parsed_call["name"], parsed_call["args"], loaded_skill_guides)
                    error = False
                except Exception as exc:
                    detail = str(exc).strip() or repr(exc) or type(exc).__name__
                    result = f"工具执行异常: {type(exc).__name__}: {detail}"
                    error = True

            validation = validate_tool_result(
                tool_name=parsed_call["name"],
                result=result,
                error=error,
            )
            display_error = error or not validation.ok
            if (
                not display_error
                and tool_capability_by_name.get(parsed_call["name"]) == CAPABILITY_SEARCH_DISCOVERY
                and result_has_sufficient_discovery(
                    parsed_call["name"],
                    result,
                    tool_description_by_name.get(parsed_call["name"]),
                    task_text=user_message,
                )
            ):
                successful_search_count += 1

            yield (
                "status",
                graph.status(
                    "validate_result",
                    error=display_error,
                    **validation_trace_payload(
                        tool_name=parsed_call["name"],
                        validation=validation,
                    ),
                ),
            )

            yield (
                "tool_result",
                {
                    "id": parsed_call["id"],
                    "name": parsed_call["name"],
                    "displayName": parsed_call.get("displayName"),
                    "result": result,
                    "error": display_error,
                },
            )

            context_result = compact_tool_result_for_context(
                tool_name=parsed_call["name"],
                result=result,
                is_subagent=is_subagent,
            )

            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": parsed_call["id"],
                    "content": context_result,
                }
            )

            if not validation.ok:
                full_messages.append({
                    "role": "system",
                    "content": (
                        f"ToolResultValidation: 工具结果未通过校验（{validation.reason}）。"
                        f"{validation.fallback_hint}"
                    ),
                })

    yield ("status", graph.status("respond", reason="max_tool_calls"))
    if is_subagent:
        return
    yield ("token", _MAX_TOOL_CALLS_WARNING)
