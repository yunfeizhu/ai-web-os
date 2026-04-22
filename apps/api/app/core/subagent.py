"""Sub-agent execution utilities for manager-style multi-agent workflows."""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncIterator

from app.core.agent_types import (
    SUBAGENT_OUTPUT_CONTRACT,
    get_agent_role,
    normalize_role_id,
)
from app.core.llm_provider import agent_loop


# Top-level Lead Agent is depth 0. Specialist tool-agents run at depth 1.
# Further nesting is deliberately disabled until there is a richer scheduler.
MAX_AGENT_DEPTH = 1
MAX_PARALLEL_SUBAGENTS = 4


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_\-\u4e00-\u9fff]+", "_", str(value or "").strip())
    slug = slug.strip("_-").lower()
    return slug[:40] or "agent"


def normalize_subagent_specs(specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize model-provided delegation specs into the runtime contract."""
    normalized: list[dict[str, Any]] = []
    for index, raw in enumerate(specs or []):
        if not isinstance(raw, dict):
            continue
        task = str(raw.get("task") or raw.get("query") or "").strip()
        if not task:
            continue
        role_id = normalize_role_id(
            str(raw.get("role") or raw.get("agent") or raw.get("agent_role") or "")
        )
        agent_name = str(raw.get("agent_name") or raw.get("name") or "").strip()
        if not agent_name:
            agent_name = f"{role_id}_{index + 1}"
        allowed_tools = raw.get("allowed_tools")
        if not isinstance(allowed_tools, list):
            allowed_tools = None
        normalized.append({
            "role": role_id,
            "task": task,
            "agent_name": _slug(agent_name),
            "output_format": str(raw.get("output_format") or "").strip(),
            "success_criteria": str(raw.get("success_criteria") or "").strip(),
            "allowed_tools": [
                str(name).strip()
                for name in (allowed_tools or [])
                if str(name).strip()
            ] or None,
        })
    return normalized


def _build_task_message(spec: dict[str, Any]) -> str:
    sections = [f"任务：{spec['task']}"]
    if spec.get("output_format"):
        sections.append(f"输出格式：{spec['output_format']}")
    if spec.get("success_criteria"):
        sections.append(f"完成标准：{spec['success_criteria']}")
    sections.append("请只完成这一个子任务，并在最终回答中给出可被 Lead Agent 综合的结果。")
    return "\n\n".join(sections)


def _namespace_tool_event_id(payload: dict[str, Any], subagent_id: str) -> None:
    """Keep parallel sub-agent tool IDs unique for streaming UI and persistence."""
    raw_id = str(payload.get("id") or "").strip()
    if not raw_id:
        return
    prefix = f"{subagent_id}::"
    if raw_id.startswith(prefix):
        return
    payload["id"] = f"{prefix}{raw_id}"


async def run_subagent(
    spec: dict[str, Any],
    *,
    model: str,
    api_key: str,
    provider_id: str = "",
    compat_type: str = "openai",
    api_base: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    max_iterations: int = 8,
    skill_context: dict | None = None,
    request_id: str | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Run a single specialist agent and tag all events with subagent metadata."""
    role = get_agent_role(str(spec.get("role") or "research"))
    agent_name = str(spec.get("agent_name") or role.id)
    subagent_id = f"{role.id}-{_slug(agent_name)}-{uuid.uuid4().hex[:6]}"

    ctx = dict(skill_context or {})
    current_depth = int(ctx.get("agent_depth", 0))
    if current_depth >= MAX_AGENT_DEPTH:
        yield (
            "subagent_result",
            {
                "subagentId": subagent_id,
                "agentName": agent_name,
                "role": role.id,
                "task": spec.get("task") or "",
                "answer": "",
                "failed": True,
                "error": "max_agent_depth_exceeded",
            },
        )
        return

    ctx["agent_depth"] = current_depth + 1
    ctx["is_subagent"] = True
    ctx["agent_role"] = role.id
    ctx["parent_request_id"] = request_id
    if spec.get("allowed_tools"):
        ctx["allowed_tools"] = list(spec["allowed_tools"])

    tokens: list[str] = []
    failed = False
    error_msg = ""
    started_at = time.perf_counter()

    system_prompt = f"{role.system_prompt}{SUBAGENT_OUTPUT_CONTRACT}"
    user_task = _build_task_message(spec)

    base_payload = {
        "subagentId": subagent_id,
        "agentName": agent_name,
        "role": role.id,
        "subagentTask": spec.get("task") or "",
    }

    try:
        async for event_type, payload in agent_loop(
            model=model,
            messages=[{"role": "user", "content": user_task}],
            api_key=api_key,
            provider_id=provider_id,
            compat_type=compat_type,
            api_base=api_base,
            temperature=temperature,
            max_tokens=max_tokens,
            max_iterations=min(max_iterations, role.max_iterations),
            system_prompt=system_prompt,
            skill_context=ctx,
            request_id=f"{request_id}:{subagent_id}" if request_id else subagent_id,
        ):
            if event_type == "token":
                if isinstance(payload, str):
                    tokens.append(payload)
                yield (
                    "subagent_token",
                    {
                        **base_payload,
                        "token": payload if isinstance(payload, str) else "",
                    },
                )
                continue

            tagged = dict(payload) if isinstance(payload, dict) else {"content": payload}
            if event_type in {"tool_call", "tool_result"}:
                _namespace_tool_event_id(tagged, subagent_id)
            tagged.update(base_payload)
            yield (event_type, tagged)

    except Exception as exc:
        failed = True
        error_msg = f"{type(exc).__name__}: {exc}"

    yield (
        "subagent_result",
        {
            "subagentId": subagent_id,
            "agentName": agent_name,
            "role": role.id,
            "task": spec.get("task") or "",
            "answer": "".join(tokens).strip(),
            "failed": failed,
            "error": error_msg if failed else None,
            "elapsedMs": int((time.perf_counter() - started_at) * 1000),
        },
    )


async def run_subagents_parallel(
    specs: list[dict[str, Any]],
    *,
    model: str,
    api_key: str,
    provider_id: str = "",
    compat_type: str = "openai",
    api_base: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    max_iterations: int = 8,
    skill_context: dict | None = None,
    request_id: str | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Run specialist agents concurrently and merge their event streams."""
    normalized = normalize_subagent_specs(specs)
    if not normalized:
        return

    runnable = normalized[:MAX_PARALLEL_SUBAGENTS]
    overflow = normalized[MAX_PARALLEL_SUBAGENTS:]

    queue: asyncio.Queue[tuple[str, Any] | None] = asyncio.Queue()
    remaining = [len(runnable)]

    async def _run_one(spec: dict[str, Any]) -> None:
        try:
            async for event in run_subagent(
                spec,
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
                await queue.put(event)
        finally:
            remaining[0] -= 1
            if remaining[0] == 0:
                await queue.put(None)

    tasks = [asyncio.create_task(_run_one(spec)) for spec in runnable]

    for spec in overflow:
        await queue.put((
            "subagent_result",
            {
                "subagentId": f"{spec['role']}-{spec['agent_name']}-skipped",
                "agentName": spec["agent_name"],
                "role": spec["role"],
                "task": spec["task"],
                "answer": "",
                "failed": True,
                "error": f"parallel_limit_exceeded:{MAX_PARALLEL_SUBAGENTS}",
            },
        ))

    while True:
        item = await queue.get()
        if item is None:
            break
        yield item

    for task in tasks:
        if not task.done():
            task.cancel()


def build_subagent_tool_result(results: list[dict[str, Any]]) -> str:
    """Build structured JSON tool_result from specialist outputs."""
    successful: dict[str, str] = {}
    agents: list[dict[str, Any]] = []
    failed: list[str] = []
    errors: dict[str, str] = {}

    for result in results:
        name = str(result.get("agentName") or result.get("subagentId") or "unknown")
        role = str(result.get("role") or "research")
        key = f"{role}:{name}"
        agent_record = {
            "agentName": name,
            "role": role,
            "task": result.get("task") or "",
            "failed": bool(result.get("failed")),
            "elapsedMs": result.get("elapsedMs"),
        }
        if result.get("failed"):
            failed.append(key)
            if result.get("error"):
                errors[key] = str(result["error"])
        else:
            answer = str(result.get("answer") or "")
            successful[key] = answer
            agent_record["answer"] = answer
        agents.append(agent_record)

    payload: dict[str, Any] = {
        "mode": "manager_subagents",
        "results": successful,
        "agents": agents,
    }
    if failed:
        payload["failed"] = failed
    if errors:
        payload["errors"] = errors

    return json.dumps(payload, ensure_ascii=False, indent=2)
