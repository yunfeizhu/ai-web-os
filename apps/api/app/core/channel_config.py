"""Local file configuration for external chat channels."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.config import Settings
from app.core.memory_paths import get_ai_native_home


CHANNELS_DIRNAME = "channels"
QQBOT_CONFIG_FILENAME = "qqbot.json"
QQBOT_CONFIG_VERSION = 1


class QQBotAgentConfig(BaseModel):
    userId: str = "default"
    appId: str = "ai-chat"
    model: str = "kimi-k2.5"
    providerId: str = "moonshot"
    compatType: str = "openai"
    apiKey: str = ""
    apiBase: str = ""
    enableMemory: bool = True
    systemPrompt: str = "你是 AI-Web OS 的智能助手，请简洁、友好地回答用户问题。"
    hasApiKey: bool = False


class QQBotConfig(BaseModel):
    version: int = QQBOT_CONFIG_VERSION
    enabled: bool = False
    appId: str = ""
    appSecret: str = ""
    botUserId: str = ""
    accountId: str = "default"
    allowPrivate: bool = True
    allowGroup: bool = False
    allowUnlisted: bool = False
    allowedUsers: list[str] = Field(default_factory=list)
    allowedGroups: list[str] = Field(default_factory=list)
    agent: QQBotAgentConfig = Field(default_factory=QQBotAgentConfig)
    hasAppSecret: bool = False


class QQBotConfigUpdate(QQBotConfig):
    pass


class QQBotConfigResponse(BaseModel):
    path: str
    exists: bool
    source: Literal["file", "env", "default"]
    config: QQBotConfig


class EffectiveQQBotConfig(BaseModel):
    path: str
    exists: bool
    source: Literal["file", "env", "default"]
    config: QQBotConfig


def get_channels_config_dir() -> Path:
    return get_ai_native_home().expanduser() / CHANNELS_DIRNAME


def get_qqbot_config_path() -> Path:
    return get_channels_config_dir() / QQBOT_CONFIG_FILENAME


def load_effective_qqbot_config(settings: Settings | None = None) -> EffectiveQQBotConfig:
    path = get_qqbot_config_path()
    if path.exists():
        return EffectiveQQBotConfig(
            path=str(path),
            exists=True,
            source="file",
            config=_read_config_file(path),
        )

    cfg = _config_from_env(settings or Settings())
    source: Literal["env", "default"] = "env" if _env_configured(cfg) else "default"
    return EffectiveQQBotConfig(
        path=str(path),
        exists=False,
        source=source,
        config=cfg,
    )


def load_qqbot_config_for_api(settings: Settings | None = None) -> QQBotConfigResponse:
    effective = load_effective_qqbot_config(settings)
    return QQBotConfigResponse(
        path=effective.path,
        exists=effective.exists,
        source=effective.source,
        config=_redact_config(effective.config),
    )


def save_qqbot_config_from_api(update: QQBotConfigUpdate) -> QQBotConfigResponse:
    path = get_qqbot_config_path()
    previous = _read_config_file(path) if path.exists() else QQBotConfig()
    merged = _merge_update(previous, update)
    _write_config_file(path, merged)
    return QQBotConfigResponse(
        path=str(path),
        exists=True,
        source="file",
        config=_redact_config(merged),
    )


def _read_config_file(path: Path) -> QQBotConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return QQBotConfig()
    except json.JSONDecodeError as exc:
        raise ValueError(f"QQ Bot 配置文件格式错误: {path}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"QQ Bot 配置文件必须是 JSON object: {path}")
    return QQBotConfig.model_validate(raw)


def _write_config_file(path: Path, config: QQBotConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = config.model_dump(exclude={"hasAppSecret": True, "agent": {"hasApiKey": True}})
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def _merge_update(previous: QQBotConfig, update: QQBotConfigUpdate) -> QQBotConfig:
    data = update.model_dump()
    if not str(data.get("appSecret") or "").strip():
        data["appSecret"] = previous.appSecret
    if not str(data.get("agent", {}).get("apiKey") or "").strip():
        data["agent"]["apiKey"] = previous.agent.apiKey

    data["version"] = QQBOT_CONFIG_VERSION
    data["allowedUsers"] = _normalize_list(data.get("allowedUsers"))
    data["allowedGroups"] = _normalize_list(data.get("allowedGroups"))
    return QQBotConfig.model_validate(data)


def _redact_config(config: QQBotConfig) -> QQBotConfig:
    data = config.model_dump()
    data["hasAppSecret"] = bool(str(config.appSecret or "").strip())
    data["appSecret"] = ""
    data["agent"]["hasApiKey"] = bool(str(config.agent.apiKey or "").strip())
    data["agent"]["apiKey"] = ""
    return QQBotConfig.model_validate(data)


def _config_from_env(settings: Settings) -> QQBotConfig:
    return QQBotConfig(
        enabled=settings.qqbot_enabled,
        appId=settings.qqbot_app_id,
        appSecret=settings.qqbot_app_secret,
        botUserId=settings.qqbot_bot_user_id,
        accountId=settings.qqbot_account_id,
        allowPrivate=settings.qqbot_allow_private,
        allowGroup=settings.qqbot_allow_group,
        allowUnlisted=settings.qqbot_allow_unlisted,
        allowedUsers=_split_csv(settings.qqbot_allowed_users),
        allowedGroups=_split_csv(settings.qqbot_allowed_groups),
        agent=QQBotAgentConfig(
            userId=settings.qqbot_agent_user_id,
            appId=settings.qqbot_agent_app_id,
            model=settings.qqbot_agent_model,
            providerId=settings.qqbot_agent_provider_id,
            compatType=settings.qqbot_agent_compat_type,
            apiKey=settings.qqbot_agent_api_key,
            apiBase=settings.qqbot_agent_api_base or "",
            enableMemory=settings.qqbot_enable_memory,
            systemPrompt=settings.qqbot_agent_system_prompt,
        ),
    )


def _env_configured(config: QQBotConfig) -> bool:
    return any(
        [
            config.enabled,
            bool(config.appId),
            bool(config.appSecret),
            bool(config.agent.apiKey),
            bool(config.allowedUsers),
            bool(config.allowedGroups),
        ]
    )


def _split_csv(value: str) -> list[str]:
    return _normalize_list(str(value or "").split(","))


def _normalize_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        items = value.split(",")
    else:
        items = value
    return [str(item).strip() for item in items if str(item).strip()]
