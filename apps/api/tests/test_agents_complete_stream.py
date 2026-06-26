import asyncio
import json

from app.api.v1 import agents as agents_api


def test_complete_stream_yields_token_events(monkeypatch):
    async def fake_stream_chat(**_kwargs):
        yield "你"
        yield "好"

    monkeypatch.setattr(agents_api, "stream_chat", fake_stream_chat)

    response = asyncio.run(
        agents_api.complete_stream(
            agents_api.CompleteRequest(
                message="hello",
                model="fake-model",
                provider_id="openai-compatible",
            ),
            x_api_key="fake-key",
        ),
    )

    async def collect_body():
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        return "".join(chunks)

    body = asyncio.run(collect_body())

    assert response.media_type == "text/event-stream"
    assert f"data: {json.dumps({'token': '你'}, ensure_ascii=False)}" in body
    assert f"data: {json.dumps({'token': '好'}, ensure_ascii=False)}" in body
    assert "data: [DONE]" in body
