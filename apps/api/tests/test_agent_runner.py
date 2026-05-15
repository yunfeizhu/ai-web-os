import asyncio

from app.core.agent_runner import AgentTurnRequest, AgentTurnRunner


async def fake_agent_loop(**kwargs):
    yield "reasoning_token", "先判断任务。"
    yield "tool_call", {"id": "call-1", "name": "search", "args": {"q": "杭州"}}
    yield "tool_result", {"id": "call-1", "result": "杭州晴。"}
    yield "token", "今天杭州晴。"


def test_agent_turn_runner_collects_final_answer_and_internal_trace():
    saved = []

    async def save_turn(**kwargs):
        saved.append(kwargs)
        return "天气"

    async def build_skill_prompt(**kwargs):
        return kwargs["system_prompt"], {"available_tools": []}

    runner = AgentTurnRunner(
        agent_loop_func=fake_agent_loop,
        save_turn_func=save_turn,
        build_skill_prompt_func=build_skill_prompt,
        memory_manager_factory=None,
    )

    result = asyncio.run(
        runner.run(
            AgentTurnRequest(
                conversation_id="conv-1",
                user_message="查一下杭州天气",
                model="kimi-k2.5",
                provider_id="moonshot",
                api_key="test-key",
                app_id="ai-chat",
                history=[],
            )
        )
    )

    assert result.content == "今天杭州晴。"
    assert result.reasoning_content == "先判断任务。"
    assert result.tool_calls == [{"id": "call-1", "name": "search", "args": {"q": "杭州"}}]
    assert result.tool_results == [{"id": "call-1", "result": "杭州晴。"}]
    assert result.title == "天气"
    assert saved[0]["assistant_content"] == "今天杭州晴。"
    assert saved[0]["reasoning_content"] == "先判断任务。"
