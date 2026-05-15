import os

from app.core.channel_config import (
    QQBotConfigUpdate,
    get_qqbot_config_path,
    load_effective_qqbot_config,
    load_qqbot_config_for_api,
    save_qqbot_config_from_api,
)


def test_save_qqbot_config_writes_local_file_and_redacts_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path))

    saved = save_qqbot_config_from_api(
        QQBotConfigUpdate(
            enabled=True,
            appId="app-id",
            appSecret="app-secret",
            allowPrivate=True,
            allowGroup=True,
            allowedUsers=["user-openid"],
            allowedGroups=["group-openid"],
            agent={
                "model": "kimi-k2.5",
                "providerId": "moonshot",
                "apiKey": "model-key",
                "apiBase": "https://api.example.com/v1",
            },
        )
    )

    assert saved.path == str(get_qqbot_config_path())
    assert saved.config.appSecret == ""
    assert saved.config.hasAppSecret is True
    assert saved.config.agent.apiKey == ""
    assert saved.config.agent.hasApiKey is True

    effective = load_effective_qqbot_config()
    assert effective.source == "file"
    assert effective.config.enabled is True
    assert effective.config.appSecret == "app-secret"
    assert effective.config.agent.apiKey == "model-key"


def test_save_qqbot_config_preserves_existing_secrets_when_blank(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path))
    save_qqbot_config_from_api(
        QQBotConfigUpdate(
            enabled=True,
            appId="app-id",
            appSecret="app-secret",
            agent={"apiKey": "model-key"},
        )
    )

    save_qqbot_config_from_api(
        QQBotConfigUpdate(
            enabled=False,
            appId="new-app-id",
            appSecret="",
            agent={"apiKey": "", "model": "qwen-plus"},
        )
    )

    effective = load_effective_qqbot_config()
    assert effective.config.enabled is False
    assert effective.config.appId == "new-app-id"
    assert effective.config.appSecret == "app-secret"
    assert effective.config.agent.apiKey == "model-key"
    assert effective.config.agent.model == "qwen-plus"


def test_load_effective_qqbot_config_falls_back_to_env(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path))
    monkeypatch.setenv("QQBOT_ENABLED", "true")
    monkeypatch.setenv("QQBOT_APP_ID", "env-app")
    monkeypatch.setenv("QQBOT_APP_SECRET", "env-secret")
    monkeypatch.setenv("QQBOT_AGENT_API_KEY", "env-model-key")
    monkeypatch.setenv("QQBOT_ALLOWED_USERS", "u1,u2")

    effective = load_effective_qqbot_config()

    assert effective.source == "env"
    assert effective.config.enabled is True
    assert effective.config.appId == "env-app"
    assert effective.config.appSecret == "env-secret"
    assert effective.config.agent.apiKey == "env-model-key"
    assert effective.config.allowedUsers == ["u1", "u2"]
    assert load_qqbot_config_for_api().exists is False

    for key in [
        "QQBOT_ENABLED",
        "QQBOT_APP_ID",
        "QQBOT_APP_SECRET",
        "QQBOT_AGENT_API_KEY",
        "QQBOT_ALLOWED_USERS",
    ]:
        os.environ.pop(key, None)
