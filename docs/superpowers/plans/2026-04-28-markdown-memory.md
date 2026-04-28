# Markdown Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mem0-as-primary memory flow with a local Markdown-first memory backend for Phase 1-3.

**Architecture:** `MEMORY.md` and daily Markdown files are the source of truth. The existing `app.core.memory` public interface stays compatible so WebSocket and settings UI can migrate incrementally. Consolidation promotes daily candidates into `MEMORY.md` and writes a human-readable `DREAMS.md` report.

**Tech Stack:** Python 3.11, FastAPI, pytest, pathlib, JSON sidecar state under `~/.ai-native-os/memory/.dreams`.

---

### Task 1: Memory Paths

**Files:**
- Create: `apps/api/app/core/memory_paths.py`
- Test: `apps/api/tests/test_markdown_memory_paths.py`

- [x] Write tests for `AI_NATIVE_OS_HOME` override, default home root, memory directory creation, and safe profile slugs.
- [x] Run `uv run pytest tests/test_markdown_memory_paths.py -q` and verify tests fail because the module does not exist.
- [x] Implement path helpers with no FastAPI dependency.
- [x] Re-run the path tests and verify they pass.

### Task 2: Markdown Parser And Manager

**Files:**
- Create: `apps/api/app/core/markdown_memory.py`
- Test: `apps/api/tests/test_markdown_memory_manager.py`

- [x] Write tests for directory initialization, parsing manual `MEMORY.md` bullets, adding daily candidates, lexical search fallback, deleting long-term memory, and clearing `MEMORY.md` with a backup.
- [x] Run `uv run pytest tests/test_markdown_memory_manager.py -q` and verify tests fail because implementation is missing.
- [x] Implement `MarkdownMemoryManager` with compatible `metadata`, `get_all`, `search`, `add_async`, `delete`, and `delete_all` methods.
- [x] Re-run manager tests and verify they pass.

### Task 3: Consolidation

**Files:**
- Create: `apps/api/app/core/memory_consolidation.py`
- Test: `apps/api/tests/test_memory_consolidation.py`

- [x] Write tests for explicit candidate promotion, duplicate skipping, and `DREAMS.md` report generation.
- [x] Run `uv run pytest tests/test_memory_consolidation.py -q` and verify tests fail because consolidation is missing.
- [x] Implement Light/REM/Deep minimal consolidation over local daily candidates.
- [x] Re-run consolidation tests and verify they pass.

### Task 4: Compatibility Wrapper

**Files:**
- Modify: `apps/api/app/core/memory.py`
- Test: `apps/api/tests/test_markdown_memory_manager.py`

- [x] Write compatibility assertions that `ensure_memory_manager` returns a usable manager even without embedding config.
- [x] Run targeted tests and verify the new assertion fails against the current mem0-gated implementation.
- [x] Replace the public manager wiring with `MarkdownMemoryManager` while preserving `collection_name_for_embedding`.
- [x] Re-run targeted tests and verify they pass.

### Task 5: Memory API

**Files:**
- Modify: `apps/api/app/api/v1/memory.py`
- Test: `apps/api/tests/test_memory_api.py`

- [x] Write API tests for `/memory`, `/memory/status`, `/memory/candidates`, `/memory/consolidate`, `/memory/files/memory`, and `/memory/reindex`.
- [x] Run API tests and verify they fail because routes are missing or old behavior is mem0-only.
- [x] Implement the new endpoints while keeping old response fields compatible.
- [x] Re-run API tests and verify they pass.

### Task 6: Regression Verification

**Files:**
- Modify as needed only if tests expose integration failures.

- [x] Run all new memory tests together.
- [x] Run relevant existing backend tests that touch chat/memory/API.
- [x] Add write-safety hardening found during final review: shared profile write lock, atomic UTF-8 replace, backups for MEMORY/DREAMS/daily overwrites, concurrent add/consolidation regression tests.
- [x] Do not run frontend build. If frontend files are not changed, no frontend verification is required.
