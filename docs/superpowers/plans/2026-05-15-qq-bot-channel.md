# QQ Bot Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first usable QQ official Bot channel that receives text messages through `qq-botpy`, runs the existing AI-Web OS Agent, and replies with the final answer.

**Architecture:** Add a generic channel layer rather than a QQ-only shortcut. `QQBotpyAdapter` normalizes QQ SDK events, `ChannelHub` handles dedupe, allowlist, peer locks, commands, and conversation binding, and `AgentTurnRunner` reuses the current Agent loop with memory, Skills, MCP tools, and message persistence.

**Tech Stack:** FastAPI lifespan, SQLAlchemy async models, `qq-botpy`, current `agent_loop`, pytest.

---

### Task 1: Channel Core

**Files:**
- Create: `apps/api/app/core/channel_types.py`
- Create: `apps/api/app/core/channel_store.py`
- Create: `apps/api/app/core/channel_hub.py`
- Test: `apps/api/tests/test_channel_hub.py`

- [ ] Write failing tests for dedupe, allowlist, `/new`, and per-peer serialization with a fake runner and in-memory store.
- [ ] Implement normalized channel dataclasses and a store protocol.
- [ ] Implement `ChannelHub.handle_inbound()` to return outbound messages only once per external message.
- [ ] Verify with `uv run pytest tests/test_channel_hub.py -q`.

### Task 2: Agent Runner

**Files:**
- Create: `apps/api/app/core/agent_runner.py`
- Test: `apps/api/tests/test_agent_runner.py`

- [ ] Write a failing test proving the runner collects only final answer content for channel replies while persisting reasoning/tool metadata internally.
- [ ] Implement a reusable `AgentTurnRunner` around the existing `agent_loop` and memory/skill setup.
- [ ] Verify with `uv run pytest tests/test_agent_runner.py -q`.

### Task 3: Persistence

**Files:**
- Create: `apps/api/app/models/channel.py`
- Modify: `apps/api/app/core/database.py`
- Test: `apps/api/tests/test_channel_store.py`

- [ ] Write failing tests for binding lookup and message dedupe records.
- [ ] Add `channel_bindings` and `channel_messages` ORM models.
- [ ] Add development schema patches and model imports.
- [ ] Verify with `uv run pytest tests/test_channel_store.py -q`.

### Task 4: QQ Bot Adapter

**Files:**
- Create: `apps/api/app/core/channels/__init__.py`
- Create: `apps/api/app/core/channels/qqbotpy_adapter.py`
- Test: `apps/api/tests/test_qqbotpy_adapter.py`

- [ ] Write failing tests for C2C text normalization and group-at normalization.
- [ ] Implement optional `qq-botpy` imports so normal backend tests still run without credentials.
- [ ] Reply through `post_c2c_message` or `post_group_message` with final answer text.
- [ ] Verify with `uv run pytest tests/test_qqbotpy_adapter.py -q`.

### Task 5: Runtime Wiring

**Files:**
- Create: `apps/api/app/core/channel_runtime.py`
- Modify: `apps/api/app/config.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/pyproject.toml`
- Modify: `.env.example`

- [ ] Add QQ Bot and channel Agent environment settings.
- [ ] Start/stop QQ adapter from FastAPI lifespan only when `QQBOT_ENABLED=true`.
- [ ] Add `qq-botpy` dependency.
- [ ] Verify with `uv run pytest tests/test_channel_hub.py tests/test_qqbotpy_adapter.py -q`.

### Task 6: Final Verification

- [ ] Run `uv run pytest -q` from `apps/api`.
- [ ] If `uv.lock` changes are needed, update it with `uv lock`.
- [ ] Report exactly how to configure `.env` and restart the API for QQ Bot testing.
