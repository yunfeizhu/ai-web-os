"""LangGraph-backed runtime facade for the agent harness.

The main LLM loop is still kept stable in `llm_provider.py`, but its control
nodes now have a real LangGraph state/checkpoint layer underneath. This gives
us a safe migration path:

1. Keep the existing streaming/tool event contract.
2. Checkpoint every Harness node transition.
3. Move node bodies into the graph incrementally instead of rewriting the loop
   in one risky step.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypedDict
from uuid import uuid4


try:
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph
except Exception:  # pragma: no cover - dependency fallback for broken envs
    InMemorySaver = None  # type: ignore[assignment]
    END = "__end__"  # type: ignore[assignment]
    START = "__start__"  # type: ignore[assignment]
    StateGraph = None  # type: ignore[assignment]


GRAPH_NODES = (
    "build_context",
    "llm_decide",
    "policy_guard",
    "execute_tool",
    "validate_result",
    "respond",
)


class AgentGraphState(TypedDict, total=False):
    node: str
    payload: dict[str, Any]
    statuses: list[dict[str, Any]]
    interrupted: bool
    interrupt_reason: str
    resume_payload: dict[str, Any]


_CHECKPOINTER = InMemorySaver() if InMemorySaver is not None else None
_COMPILED_GRAPH: Any | None = None
_POSTGRES_POOL: Any | None = None


def _node_runner(node_name: str):
    def run(state: AgentGraphState) -> AgentGraphState:
        statuses = list(state.get("statuses") or [])
        statuses.append({"node": node_name, "payload": state.get("payload") or {}})
        return {"node": node_name, "statuses": statuses}

    return run


def _build_graph():
    if StateGraph is None:
        return None

    graph = StateGraph(AgentGraphState)
    for node in GRAPH_NODES:
        graph.add_node(node, _node_runner(node))

    graph.add_edge(START, "build_context")
    for left, right in zip(GRAPH_NODES, GRAPH_NODES[1:], strict=False):
        graph.add_edge(left, right)
    graph.add_edge(GRAPH_NODES[-1], END)

    return graph.compile(checkpointer=_CHECKPOINTER)


def _compiled_graph():
    global _COMPILED_GRAPH
    if _COMPILED_GRAPH is None:
        _COMPILED_GRAPH = _build_graph()
    return _COMPILED_GRAPH


async def init_checkpointer() -> None:
    """Upgrade to PostgresSaver if available; fall back to InMemorySaver.

    Called once during app startup (before serving requests). On success the
    LangGraph compiled graph is rebuilt with the persistent checkpointer so
    every subsequent call to ``AgentGraphRuntime.status()`` writes to Postgres.
    """
    global _CHECKPOINTER, _COMPILED_GRAPH, _POSTGRES_POOL

    try:
        from app.config import get_settings
        settings = get_settings()
        # Convert SQLAlchemy asyncpg URL → psycopg3 URL
        conn_str = settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

        from psycopg_pool import AsyncConnectionPool  # type: ignore[import]
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore[import]

        _POSTGRES_POOL = AsyncConnectionPool(conninfo=conn_str, max_size=5, open=False)
        await _POSTGRES_POOL.open()

        saver = AsyncPostgresSaver(_POSTGRES_POOL)
        await saver.setup()  # idempotent — creates tables if they don't exist

        _CHECKPOINTER = saver
        print("[AgentGraph] ✓ PostgresSaver checkpoint active")
    except Exception as exc:
        print(
            f"[AgentGraph] PostgresSaver unavailable "
            f"({type(exc).__name__}: {exc}), using InMemorySaver"
        )
        if _CHECKPOINTER is None and InMemorySaver is not None:
            _CHECKPOINTER = InMemorySaver()

    # Rebuild the compiled graph so it uses the new checkpointer
    _COMPILED_GRAPH = _build_graph()


async def shutdown_checkpointer() -> None:
    """Close the PostgreSQL connection pool gracefully."""
    global _POSTGRES_POOL
    if _POSTGRES_POOL is not None:
        try:
            await _POSTGRES_POOL.close()
        except Exception:
            pass
        _POSTGRES_POOL = None


@dataclass
class AgentGraphRuntime:
    """Graph runtime used by the current LiteLLM loop."""

    request_id: str | None = None
    _thread_id: str = field(init=False)
    _config: dict[str, Any] = field(init=False)

    def __post_init__(self) -> None:
        self._thread_id = self.request_id or f"agent-{uuid4()}"
        self._config = {"configurable": {"thread_id": self._thread_id}}

    @property
    def langgraph_available(self) -> bool:
        return _compiled_graph() is not None

    def status(self, node: str, **payload: Any) -> dict[str, Any]:
        if node not in GRAPH_NODES:
            node = "llm_decide"

        event = {
            "status": "graph_node",
            "node": node,
            "graph": "langgraph" if self.langgraph_available else "harness_graph",
            "threadId": self._thread_id,
            **payload,
        }

        graph = _compiled_graph()
        if graph is not None:
            try:
                checkpoint_config = graph.update_state(
                    self._config,
                    {"node": node, "payload": payload},
                )
                self._config = checkpoint_config
                checkpoint_id = checkpoint_config.get("configurable", {}).get("checkpoint_id")
                if checkpoint_id:
                    event["checkpointId"] = checkpoint_id
            except Exception as exc:  # pragma: no cover - checkpoint must not break chat
                event["checkpointError"] = str(exc)

        return event

    def interrupt(self, reason: str) -> dict[str, Any]:
        graph = _compiled_graph()
        if graph is not None:
            try:
                self._config = graph.update_state(
                    self._config,
                    {"interrupted": True, "interrupt_reason": reason},
                )
            except Exception:
                pass
        return self.status("respond", status="interrupt_requested", reason=reason)

    def resume(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        graph = _compiled_graph()
        if graph is not None:
            try:
                self._config = graph.update_state(
                    self._config,
                    {"interrupted": False, "resume_payload": payload or {}},
                )
            except Exception:
                pass
        return self.status("llm_decide", status="resume_requested", resumePayload=payload or {})

    def get_checkpoint(self) -> Any | None:
        graph = _compiled_graph()
        if graph is None:
            return None
        return graph.get_state(self._config)
