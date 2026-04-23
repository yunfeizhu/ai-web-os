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
from app.core.evidence_bundle import (
    MAX_TOOL_EVIDENCE_ITEMS,
    build_tool_evidence,
    distill_evidence_bundle,
    fallback_evidence_bundle,
)
from app.core.llm_provider import agent_loop, build_litellm_model


# Top-level Lead Agent is depth 0. Specialist tool-agents run at depth 1.
# Further nesting is deliberately disabled until there is a richer scheduler.
MAX_AGENT_DEPTH = 1
MAX_PARALLEL_SUBAGENTS = 4
DELEGATE_TOOL_CONTEXT_CHARS = 24000
MAX_MERGED_TOOL_RESULT_CHARS = 18000


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


def _strip_runtime_markers(text: str) -> str:
    return str(text or "").replace("（已达到最大工具调用次数）", "").strip()


def _evidence_handoff_summary(evidence: dict[str, Any] | None) -> str:
    if not isinstance(evidence, dict):
        return ""

    lines: list[str] = []
    facts = evidence.get("facts")
    if isinstance(facts, list):
        for fact in facts[:8]:
            if not isinstance(fact, dict):
                continue
            label = str(fact.get("label") or fact.get("field") or "事实").strip()
            value = str(fact.get("value") or "").strip()
            if not value:
                continue
            time_text = str(fact.get("time") or "").strip()
            source = str(fact.get("source_title") or fact.get("source_url") or "").strip()
            suffix_parts = [part for part in (time_text, source) if part]
            suffix = f"（{'；'.join(suffix_parts)}）" if suffix_parts else ""
            lines.append(f"- {label}: {value}{suffix}")

    if lines:
        return "\n".join(lines)

    sources = evidence.get("sources")
    if isinstance(sources, list) and sources:
        source_lines: list[str] = []
        for source in sources[:5]:
            if not isinstance(source, dict):
                continue
            title = str(source.get("title") or source.get("url") or "").strip()
            snippet = str(source.get("snippet") or "").strip()
            if not title and not snippet:
                continue
            item = title
            if snippet:
                item = f"{item}: {snippet}" if item else snippet
            source_lines.append(f"- {item[:300]}")
        if source_lines:
            return "找到以下来源证据：\n" + "\n".join(source_lines)

    summary = str(evidence.get("summary") or "").strip()
    if summary and summary != "No natural-language summary was produced.":
        return summary
    return ""


def _select_subagent_answer(
    *,
    role_id: str,
    raw_answer: str,
    evidence: dict[str, Any] | None,
    tool_evidence: list[dict[str, Any]],
) -> str:
    cleaned = _strip_runtime_markers(raw_answer)
    if role_id == "research" and tool_evidence:
        evidence_summary = _evidence_handoff_summary(evidence)
        if evidence_summary:
            return evidence_summary
    return cleaned


def _build_subagent_system_prompt(role_system_prompt: str, time_context: str | None = None) -> str:
    sections: list[str] = []
    if str(time_context or "").strip():
        sections.append(str(time_context).strip())
    if str(role_system_prompt or "").strip():
        sections.append(str(role_system_prompt).strip())
    sections.append(SUBAGENT_OUTPUT_CONTRACT.strip())
    return "\n\n".join(section for section in sections if section)


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
    tool_evidence: list[dict[str, Any]] = []
    failed = False
    error_msg = ""
    max_tool_calls_reached = False
    started_at = time.perf_counter()

    system_prompt = _build_subagent_system_prompt(
        role.system_prompt,
        ctx.get("time_context"),
    )
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
            if (
                event_type == "status"
                and tagged.get("node") == "respond"
                and tagged.get("reason") == "max_tool_calls"
            ):
                max_tool_calls_reached = True
            if event_type in {"tool_call", "tool_result"}:
                _namespace_tool_event_id(tagged, subagent_id)
            if event_type == "tool_result" and len(tool_evidence) < MAX_TOOL_EVIDENCE_ITEMS:
                evidence_item = build_tool_evidence(tagged)
                if evidence_item:
                    tool_evidence.append(evidence_item)
            tagged.update(base_payload)
            yield (event_type, tagged)

    except Exception as exc:
        failed = True
        error_msg = f"{type(exc).__name__}: {exc}"

    raw_answer = "".join(tokens).strip()
    if failed:
        evidence = fallback_evidence_bundle(
            task=str(spec.get("task") or ""),
            answer=raw_answer,
            tool_evidence=tool_evidence,
            error=error_msg,
        )
    elif role.id == "research" and tool_evidence and api_key:
        if provider_id:
            litellm_model = build_litellm_model(provider_id, model, compat_type)
        elif model.startswith("deepseek"):
            litellm_model = f"deepseek/{model}"
        elif model.startswith("gemini"):
            litellm_model = f"gemini/{model}"
        else:
            litellm_model = model
        evidence = await distill_evidence_bundle(
            litellm_model=litellm_model,
            api_key=api_key,
            api_base=api_base,
            task=str(spec.get("task") or ""),
            answer=raw_answer,
            tool_evidence=tool_evidence,
            max_tokens=min(max_tokens, 2400),
        )
    else:
        evidence = fallback_evidence_bundle(
            task=str(spec.get("task") or ""),
            answer=raw_answer,
            tool_evidence=tool_evidence,
        )

    answer = _select_subagent_answer(
        role_id=role.id,
        raw_answer=raw_answer,
        evidence=evidence,
        tool_evidence=tool_evidence,
    )

    yield (
        "subagent_result",
        {
            "subagentId": subagent_id,
            "agentName": agent_name,
            "role": role.id,
            "task": spec.get("task") or "",
            "answer": answer,
            "rawAnswer": raw_answer if raw_answer and raw_answer != answer else None,
            "evidence": evidence,
            "toolEvidence": tool_evidence,
            "failed": failed,
            "error": error_msg if failed else None,
            "maxToolCallsReached": max_tool_calls_reached,
            "stopReason": "max_tool_calls" if max_tool_calls_reached else None,
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
    evidence_by_key: dict[str, Any] = {}
    facts: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    missing_fields: list[dict[str, Any]] = []
    capabilities_used: set[str] = set()
    evidence_sufficient = False
    needs_more_tools = False
    seen_sources: set[str] = set()
    tool_evidence_items: list[dict[str, Any]] = []

    for result in results:
        name = str(result.get("agentName") or result.get("subagentId") or "unknown")
        role = str(result.get("role") or "research")
        key = f"{role}:{name}"
        evidence = result.get("evidence") if isinstance(result.get("evidence"), dict) else None
        agent_record = {
            "agentName": name,
            "role": role,
            "task": result.get("task") or "",
            "failed": bool(result.get("failed")),
            "elapsedMs": result.get("elapsedMs"),
        }
        if result.get("maxToolCallsReached"):
            agent_record["maxToolCallsReached"] = True
            agent_record["stopReason"] = result.get("stopReason") or "max_tool_calls"
        if result.get("rawAnswer"):
            agent_record["rawAnswer"] = result.get("rawAnswer")
        result_tool_evidence = (
            result.get("toolEvidence")
            if isinstance(result.get("toolEvidence"), list)
            else result.get("tool_evidence")
        )
        if isinstance(result_tool_evidence, list):
            count = 0
            for index, item in enumerate(result_tool_evidence, start=1):
                normalized = _normalize_tool_evidence_for_lead(
                    item,
                    agent_key=key,
                    agent_name=name,
                    role=role,
                    task=str(result.get("task") or ""),
                    index=index,
                )
                if normalized:
                    tool_evidence_items.append(normalized)
                    capability = str(normalized.get("capability") or "").strip()
                    if capability:
                        capabilities_used.add(capability)
                    count += 1
            if count:
                agent_record["toolEvidenceCount"] = count
        if evidence:
            evidence_by_key[key] = evidence
            agent_record["evidence"] = evidence
            for fact in evidence.get("facts") or []:
                if not isinstance(fact, dict):
                    continue
                item = dict(fact)
                item["agentKey"] = key
                item["agentName"] = name
                facts.append(item)
            for source in evidence.get("sources") or []:
                if not isinstance(source, dict):
                    continue
                source_key = str(source.get("url") or source.get("title") or "").strip()
                if source_key and source_key in seen_sources:
                    continue
                if source_key:
                    seen_sources.add(source_key)
                item = dict(source)
                item["agentKey"] = key
                item["agentName"] = name
                sources.append(item)
            for field in evidence.get("missing_fields") or []:
                label = str(field or "").strip()
                if label:
                    missing_fields.append({
                        "agentKey": key,
                        "agentName": name,
                        "field": label,
                    })
            for capability in evidence.get("capabilities_used") or []:
                text = str(capability or "").strip()
                if text:
                    capabilities_used.add(text)
            evidence_sufficient = evidence_sufficient or bool(evidence.get("evidence_sufficient"))
            needs_more_tools = needs_more_tools or bool(evidence.get("needs_more_tools"))
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
        "facts": facts,
        "sources": sources,
        "mergedToolResults": _merge_tool_evidence_for_lead(tool_evidence_items),
        "toolEvidence": tool_evidence_items,
        "missingFields": missing_fields,
        "capabilitiesUsed": sorted(capabilities_used),
        "evidenceSufficient": evidence_sufficient,
        "needsMoreTools": needs_more_tools,
        "evidence": evidence_by_key,
        "results": successful,
        "agents": agents,
    }
    if failed:
        payload["failed"] = failed
    if errors:
        payload["errors"] = errors

    return json.dumps(payload, ensure_ascii=False, indent=2)


def _normalize_tool_evidence_for_lead(
    item: Any,
    *,
    agent_key: str,
    agent_name: str,
    role: str,
    task: str,
    index: int,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    content = str(item.get("content") or "").strip()
    if not content:
        return None
    return {
        "agentKey": agent_key,
        "agentName": agent_name,
        "role": role,
        "task": task,
        "index": index,
        "tool": str(item.get("tool") or "").strip(),
        "displayName": str(item.get("displayName") or item.get("tool") or "").strip(),
        "capability": str(item.get("capability") or "").strip(),
        "error": bool(item.get("error")),
        "content": content,
    }


def _merge_tool_evidence_for_lead(items: list[dict[str, Any]]) -> str:
    if not items:
        return ""
    blocks: list[str] = []
    for item in items:
        header = (
            f"[{item.get('agentName') or item.get('agentKey')} #{item.get('index')}] "
            f"{item.get('displayName') or item.get('tool') or 'tool'}"
        )
        metadata = [
            f"agent: {item.get('agentKey')}",
            f"role: {item.get('role')}",
            f"task: {item.get('task')}",
            f"tool: {item.get('tool')}",
            f"capability: {item.get('capability') or 'unknown'}",
            f"error: {str(bool(item.get('error'))).lower()}",
        ]
        blocks.append(
            "\n".join([
                header,
                *metadata,
                "result:",
                str(item.get("content") or "").strip(),
            ])
        )

    merged = "\n\n---\n\n".join(blocks).strip()
    if len(merged) <= MAX_MERGED_TOOL_RESULT_CHARS:
        return merged
    marker = "\n\n...[merged tool results truncated; use structured facts/sources/toolEvidence above for the retained subset]"
    return merged[: max(500, MAX_MERGED_TOOL_RESULT_CHARS - len(marker))] + marker
