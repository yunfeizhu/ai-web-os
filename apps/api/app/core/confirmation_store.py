"""Registry for pending Human-in-the-loop confirmation futures.

A tool execution that requires user approval registers a Future here; the REST
endpoint (POST /api/v1/agents/confirm) resolves it once the user responds.

Design: module-level dict keyed by request_id — safe because asyncio runs in a
single thread, and each request_id is unique per WebSocket invocation.
"""

from __future__ import annotations

import asyncio

_CONFIRMATIONS: dict[str, asyncio.Future[bool]] = {}


def create_confirmation(request_id: str) -> "asyncio.Future[bool]":
    """Create and register a Future for the given request_id.

    The caller should ``await`` the returned future (with a timeout) and call
    ``discard_confirmation`` in a finally block.
    """
    loop = asyncio.get_event_loop()
    future: asyncio.Future[bool] = loop.create_future()
    _CONFIRMATIONS[request_id] = future
    return future


def resolve_confirmation(request_id: str, approved: bool) -> bool:
    """Resolve the pending Future for request_id.

    Returns True if a pending confirmation was found and resolved; False if
    there was no matching pending confirmation (already expired or not found).
    """
    future = _CONFIRMATIONS.get(request_id)
    if future and not future.done():
        future.set_result(approved)
        return True
    return False


def discard_confirmation(request_id: str) -> None:
    """Remove a confirmation entry after it has been resolved or timed out."""
    _CONFIRMATIONS.pop(request_id, None)


def pending_count() -> int:
    """Return the number of currently pending confirmations (for diagnostics)."""
    return len(_CONFIRMATIONS)
