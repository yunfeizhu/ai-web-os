"""Agent role definitions and multi-agent orchestration contracts.

The runtime intentionally supports two complementary patterns:

1. Single augmented agent: one ReAct loop owns the user conversation and calls
   normal tools directly.
2. Manager with agents-as-tools: the Lead Agent keeps ownership of the final
   answer and invokes bounded specialist agents for isolated subtasks.

This mirrors the practical split described by OpenAI Agents SDK
(`Agent.as_tool()` vs handoffs), Anthropic's orchestrator-worker pattern, and
LangChain/LangGraph's supervisor/subagent design. Conversation handoff is kept
as a documented future mode because the current product UI has one user-facing
assistant stream; specialists should not become user-facing owners yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ── Tool category constants ──────────────────────────────────────────────────

# Research worker: web search, URL fetch, browser, knowledge retrieval.
RESEARCH_TOOL_NAMES: frozenset[str] = frozenset({
    "fetch_url",
    "retrieve_knowledge",
    "memory_search",
    "memory_get",
    "load_skill_context",
})
RESEARCH_TOOL_PREFIXES: tuple[str, ...] = ("browser_", "mcp_", "skill_")
RESEARCH_TOOL_DENY_TERMS: tuple[str, ...] = (
    "calendar",
    "email",
    "mail",
    "note",
    "file",
)

# Code worker: Python exec, calculator, file read/write.
CODE_TOOL_NAMES: frozenset[str] = frozenset({
    "python_exec",
    "calculator",
    "list_files",
    "read_file",
    "write_file",
})

# System worker: file system + OS app integrations.
SYSTEM_TOOL_NAMES: frozenset[str] = frozenset({
    "list_files",
    "read_file",
    "write_file",
    "memory_search",
    "memory_get",
    "list_notes",
    "save_note",
    "load_skill_context",
})
SYSTEM_TOOL_PREFIXES: tuple[str, ...] = (
    "mcp_calendar",
    "mcp_email",
    "mcp_mail",
    "mcp_note",
    "mcp_file",
)

# Writer worker: content creation with minimal tool access.
WRITER_TOOL_NAMES: frozenset[str] = frozenset({
    "retrieve_knowledge",
    "memory_search",
    "memory_get",
    "read_file",
    "write_file",
})


# ── Role dataclass ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AgentRole:
    """Describes a specialized agent type used in multi-agent workflows.

    Attributes:
        id: Canonical identifier, e.g. "research".
        name: Human-readable display name.
        description: Used by the Lead Agent to select the right role.
        handoff_description: Short wording exposed in the delegate tool schema.
        system_prompt: System message injected into the worker's context.
        tool_allowlist: Exact tool names this role may use. None means all tools.
        tool_prefix_allowlist: Additional prefix allowlist matched by startswith.
        tool_deny_terms: Lowercase substrings that remove otherwise matched tools.
        max_iterations: ReAct loop iteration budget for this role.
    """

    id: str
    name: str
    description: str
    handoff_description: str
    system_prompt: str
    tool_allowlist: frozenset[str] | None = None
    tool_prefix_allowlist: tuple[str, ...] = field(default_factory=tuple)
    tool_deny_terms: tuple[str, ...] = field(default_factory=tuple)
    max_iterations: int = 8


# ── System prompts ───────────────────────────────────────────────────────────

RESEARCH_SYSTEM_PROMPT = """\
你是一个专业的 **Research Agent**，负责：
- 网页搜索与实时信息获取
- 知识库语义检索
- 网页抓取与内容提取
- 浏览器自动化操控

工作原则：
1. 优先使用工具获取实时数据，不依赖训练数据臆测
2. 搜索结果不足时追加搜索或更换关键词
3. 只返回与任务相关的发现，避免把完整搜索过程倒给 Lead Agent
4. 给出来源链接、时间、关键证据和不确定性
"""

RESEARCH_SYSTEM_PROMPT += """

Generic search policy:
1. Prefer search/discovery tools first for current facts.
2. If title, URL, date, and snippet evidence already answer the task, summarize from search results instead of extracting page bodies.
3. Use full-page fetch/extract only when snippets are insufficient, sources conflict, or the user asks for original text, exact quotes, full documents, or verification.
4. If a page extraction partially succeeds, keep the successful pages and ignore failed URLs unless the missing URL is essential.
"""

CODER_SYSTEM_PROMPT = """\
你是一个专业的 **Code Agent**，负责：
- Python 代码编写与执行
- 数学计算与数据处理
- 文件读写与格式转换
- 结构化数据分析

工作原则：
1. 编写可直接运行的代码，处理边界情况
2. 代码执行后验证结果的正确性
3. 返回结构化输出，附带输入、方法、结果和校验
4. 数学计算优先使用 calculator，复杂逻辑使用 python_exec
"""

SYSTEM_SYSTEM_PROMPT = """\
你是 AI-Native OS 的 **System Agent**，负责：
- 文件系统操作（读取、写入、整理）
- 日历事件管理（创建、查询、删除）
- 邮件收发
- 笔记与文档管理

工作原则：
1. 精确执行用户的系统操作指令
2. 危险操作（删除、覆写）前必须确认
3. 操作后返回结果确认信息
4. 对虚拟文件系统（路径以 / 开头）、MCP 工具和真实系统边界保持清晰
"""

WRITER_SYSTEM_PROMPT = """\
你是一个专业的 **Writer Agent**，负责：
- 内容创作与结构化写作
- 文本翻译与改写
- 邮件、报告、文档撰写
- Markdown 格式化输出

工作原则：
1. 内容准确、结构清晰、风格一致
2. 根据上下文判断文体和语气
3. 直接输出完整内容，无需过度解释行动计划
4. 有必要时检索知识库以确保事实准确性
"""

SUBAGENT_OUTPUT_CONTRACT = """\

## 子 Agent 输出契约

- Lead Agent 只能看到你的最终回答和少量结构化元信息，看不到你的完整内部过程。
- 最终回答必须包含：结论、关键依据、已使用的数据/工具、无法确认的部分。
- 如果任务要求固定格式，严格按任务里的 `output_format` 输出。
- 如果工具失败或信息不足，明确说明失败原因，不要补编事实。
- Lead Agent 会额外接收一份结构化 EvidenceBundle。你的自然语言最终回答仍应覆盖任务中点名要求的关键字段，例如温度、湿度、价格、日期、地点、来源等；缺失字段要显式说明。
- 搜索结果已经包含足够标题、URL、日期和摘要证据时，直接基于搜索结果总结；只有摘要不足、来源冲突或用户要求原文/精确引用时才继续抓取正文。
"""


def build_supervisor_prompt(agent_mode: str = "auto") -> str:
    """Build the Lead Agent prompt fragment injected into the top-level loop."""
    role_lines = "\n".join(
        f"- `{role.id}`: {role.handoff_description}"
        for role in list_worker_roles()
    )
    mode_hint = (
        "当前模式为 single：不要委派子 Agent。"
        if str(agent_mode or "").lower() == "single"
        else "当前模式为 auto：优先单 Agent，只有任务收益明确时才委派。"
    )
    return f"""\
[多 Agent 调度规则]
你是 AI-Native OS 的 Lead Agent。你始终拥有用户对话和最终回答所有权。

{mode_hint}

可委派角色：
{role_lines}

什么时候保持单 Agent：
- 普通知识问答、聊天、一次工具调用能完成的任务。
- 需要连续和用户澄清的任务。
- 子任务之间强依赖且上一步结果会决定下一步做什么。

什么时候调用 `delegate_task`：
- 多个互相独立的搜索、分析、文件/系统操作可以并行。
- 单一请求横跨多个专业领域，给所有工具直接塞进一个上下文会增加误用风险。
- 长上下文检索/浏览/代码执行需要隔离，Lead Agent 只需要最终摘要。

委派要求：
- 每个子任务必须自洽，包含目标、边界、必要上下文、期望输出。
- 为每个子任务指定 `role`，只能使用 research/coder/system/writer。
- 并行任务之间不能互相依赖；有依赖时先自己执行或分轮委派。
- 子 Agent 是工具，不是对话接管者；你必须综合结果后再回答用户。
- `delegate_task` 返回结构化 `facts` / `sources` / `missingFields` 时，最终回答优先使用 `facts` 和证据片段；如果 facts 已包含搜索标题、摘要、链接或时间，不要因为子 Agent 的自然语言 answer 保守或遗漏而声称“没有具体内容”。
- `delegate_task` 返回 `mergedToolResults` / `toolEvidence` 时，把它们视为子 Agent 的原始工具证据；当 `facts` 或自然语言 answer 漏掉价格、温度、成交量、日期等字段时，必须回看这些原始工具结果再回答。
"""


# ── Agent registry ───────────────────────────────────────────────────────────

AGENT_REGISTRY: dict[str, AgentRole] = {
    "research": AgentRole(
        id="research",
        name="Research Agent",
        description="Web search, knowledge retrieval, URL fetching, browser automation",
        handoff_description="实时信息、网页/知识库检索、资料归纳、需要来源的事实核查。",
        system_prompt=RESEARCH_SYSTEM_PROMPT,
        tool_allowlist=RESEARCH_TOOL_NAMES,
        tool_prefix_allowlist=RESEARCH_TOOL_PREFIXES,
        tool_deny_terms=RESEARCH_TOOL_DENY_TERMS,
        max_iterations=10,
    ),
    "coder": AgentRole(
        id="coder",
        name="Code Agent",
        description="Python execution, math calculations, data processing, file operations",
        handoff_description="代码执行、数学计算、数据清洗、结构化分析、可验证计算。",
        system_prompt=CODER_SYSTEM_PROMPT,
        tool_allowlist=CODE_TOOL_NAMES,
        max_iterations=8,
    ),
    "system": AgentRole(
        id="system",
        name="System Agent",
        description="File management, calendar, email, notes, document operations",
        handoff_description="虚拟文件系统、日历、邮件、笔记、文档和本地系统动作。",
        system_prompt=SYSTEM_SYSTEM_PROMPT,
        tool_allowlist=SYSTEM_TOOL_NAMES,
        tool_prefix_allowlist=SYSTEM_TOOL_PREFIXES,
        max_iterations=8,
    ),
    "writer": AgentRole(
        id="writer",
        name="Writer Agent",
        description="Content creation, translation, text rewriting, document formatting",
        handoff_description="写作、翻译、改写、报告整理、Markdown/文档排版。",
        system_prompt=WRITER_SYSTEM_PROMPT,
        tool_allowlist=WRITER_TOOL_NAMES,
        max_iterations=5,
    ),
}

ROLE_ALIASES: dict[str, str] = {
    "search": "research",
    "researcher": "research",
    "web": "research",
    "browser": "research",
    "code": "coder",
    "python": "coder",
    "data": "coder",
    "file": "system",
    "files": "system",
    "calendar": "system",
    "mail": "system",
    "email": "system",
    "document": "writer",
    "writing": "writer",
    "draft": "writer",
}


# ── Accessors ────────────────────────────────────────────────────────────────

def normalize_role_id(role_id: str | None) -> str:
    raw = str(role_id or "").strip().lower()
    if not raw:
        return "research"
    return ROLE_ALIASES.get(raw, raw)


def get_agent_role(role_id: str | None) -> AgentRole:
    """Return AgentRole by id. Falls back to 'research' for unknown ids."""
    return AGENT_REGISTRY.get(normalize_role_id(role_id)) or AGENT_REGISTRY["research"]


def agent_role_ids() -> list[str]:
    """Return the role ids exposed to the Lead Agent."""
    return list(AGENT_REGISTRY.keys())


def list_worker_roles() -> list[AgentRole]:
    """Return all callable specialist roles."""
    return list(AGENT_REGISTRY.values())


def filter_tools_for_role(tools: list[dict[str, Any]], role: AgentRole) -> list[dict[str, Any]]:
    """Restrict tool schemas to those permitted by the agent role.

    Matching logic:
      1. role.tool_allowlist is None -> return all tools except denied terms.
      2. tool name in role.tool_allowlist.
      3. tool name starts with any prefix in role.tool_prefix_allowlist.
      4. any denied term removes the tool even if it matched a prefix.
    """
    result: list[dict[str, Any]] = []
    for tool in tools:
        name = str((tool.get("function") or {}).get("name") or "")
        if not name:
            continue
        lowered = name.lower()
        if role.tool_deny_terms and any(term in lowered for term in role.tool_deny_terms):
            continue
        if role.tool_allowlist is None and not role.tool_prefix_allowlist:
            result.append(tool)
            continue
        if role.tool_allowlist and name in role.tool_allowlist:
            result.append(tool)
            continue
        for prefix in role.tool_prefix_allowlist:
            if name.startswith(prefix):
                result.append(tool)
                break
    return result
