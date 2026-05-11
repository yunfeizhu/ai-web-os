import asyncio

import httpx

from app.core.legacy_memory_import import import_legacy_qdrant_memories
from app.core.markdown_memory import MarkdownMemoryManager


def test_import_legacy_qdrant_memories_writes_markdown_records(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 事实与背景\n\n"
        "- 已有偏好\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/collections":
            return httpx.Response(
                200,
                json={
                    "result": {
                        "collections": [
                            {"name": "ai_os_mem_qwen3_embedding_8b_4096"},
                            {"name": "ai_os_kb_default"},
                        ]
                    }
                },
            )
        if (
            request.method == "POST"
            and request.url.path
            == "/collections/ai_os_mem_qwen3_embedding_8b_4096/points/scroll"
        ):
            return httpx.Response(
                200,
                json={
                    "result": {
                        "points": [
                            {
                                "id": "point-1",
                                "payload": {
                                    "user_id": "default",
                                    "data": "用户喜欢用 Markdown 文件管理本地记忆",
                                    "created_at": "2026-04-08T12:00:00+00:00",
                                },
                            },
                            {
                                "id": "point-2",
                                "payload": {
                                    "user_id": "default",
                                    "data": "已有偏好",
                                },
                            },
                            {
                                "id": "point-3",
                                "payload": {
                                    "user_id": "other",
                                    "data": "其他用户记忆",
                                },
                            },
                        ]
                    }
                },
            )
        return httpx.Response(404)

    result = import_legacy_qdrant_memories(
        manager,
        qdrant_url="http://qdrant.test",
        transport=httpx.MockTransport(handler),
    )
    records = asyncio.run(manager.get_all())

    assert result.imported == 1
    assert result.duplicates == 1
    assert result.skipped == 1
    assert [record["memory"] for record in records] == [
        "已有偏好",
        "用户喜欢用 Markdown 文件管理本地记忆",
    ]
    assert "<!--" not in manager.read_memory_markdown()
    assert "qdrant" not in manager.read_memory_markdown()
