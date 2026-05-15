import asyncio

from app.api.v1.channels import get_qqbot_config, update_qqbot_config
from app.core.channel_config import QQBotConfigUpdate


def test_channels_api_updates_and_returns_redacted_config(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path))

    updated = asyncio.run(
        update_qqbot_config(
            QQBotConfigUpdate(
                enabled=True,
                appId="app-id",
                appSecret="secret",
                agent={"apiKey": "model-key"},
            )
        )
    )
    fetched = asyncio.run(get_qqbot_config())

    assert updated.config.enabled is True
    assert fetched.exists is True
    assert fetched.config.appSecret == ""
    assert fetched.config.hasAppSecret is True
    assert fetched.config.agent.apiKey == ""
    assert fetched.config.agent.hasApiKey is True
