"""Runtime wiring for optional external chat channels."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.config import Settings
from app.core.agent_runner import AgentTurnRunner
from app.core.channel_config import QQBotConfig, load_effective_qqbot_config
from app.core.channel_hub import ChannelHub, ChannelHubConfig
from app.core.channel_store import SQLChannelStore
from app.core.channels.qqbotpy_adapter import QQBotpyAdapter, QQBotpyRuntime

_qqbot_runtime: QQBotpyRuntime | None = None
_qqbot_status: dict[str, Any] = {
    "enabled": False,
    "running": False,
    "source": "default",
    "path": "",
    "message": "未启用",
    "startedAt": None,
    "error": "",
}


async def startup_channel_runtimes(settings: Settings) -> None:
    await startup_qqbot_runtime(settings)


async def shutdown_channel_runtimes() -> None:
    global _qqbot_runtime
    if _qqbot_runtime is not None:
        await _qqbot_runtime.stop()
        _qqbot_runtime = None
    _set_qqbot_status(running=False, message="已停止")


async def startup_qqbot_runtime(settings: Settings) -> None:
    global _qqbot_runtime
    if _qqbot_runtime is not None:
        return

    effective = load_effective_qqbot_config(settings)
    cfg = effective.config
    _set_qqbot_status(
        enabled=cfg.enabled,
        running=False,
        source=effective.source,
        path=effective.path,
        message="未启用" if not cfg.enabled else "准备启动",
        error="",
    )
    if not cfg.enabled:
        return

    if not cfg.appId or not cfg.appSecret:
        message = "QQ Bot 已启用，但缺少 App ID 或 App Secret。"
        print(f"[QQBot] {message}")
        _set_qqbot_status(message=message, error=message)
        return

    if not cfg.agent.apiKey:
        message = "QQ Bot 已启用，但缺少模型 API Key。"
        print(f"[QQBot] {message}")
        _set_qqbot_status(message=message, error=message)
        return

    loop = asyncio.get_running_loop()
    _qqbot_runtime = _build_qqbot_runtime(cfg, loop)
    _qqbot_runtime.start()
    _set_qqbot_status(
        enabled=True,
        running=True,
        source=effective.source,
        path=effective.path,
        message="qq-botpy runtime 已启动",
        startedAt=datetime.now(timezone.utc).isoformat(),
        error="",
    )
    print("[QQBot] qq-botpy runtime started.")


async def restart_qqbot_runtime(settings: Settings | None = None) -> None:
    await shutdown_channel_runtimes()
    await startup_qqbot_runtime(settings or Settings())


def qqbot_runtime_status() -> dict[str, Any]:
    return dict(_qqbot_status)


def _build_qqbot_runtime(
    cfg: QQBotConfig,
    loop: asyncio.AbstractEventLoop,
) -> QQBotpyRuntime:
    hub = ChannelHub(
        store=SQLChannelStore(),
        runner=AgentTurnRunner(),
        config=ChannelHubConfig(
            default_user_id=cfg.agent.userId,
            default_app_id=cfg.agent.appId,
            default_model=cfg.agent.model,
            default_provider_id=cfg.agent.providerId,
            default_compat_type=cfg.agent.compatType,
            default_system_prompt=cfg.agent.systemPrompt,
            api_key=cfg.agent.apiKey,
            api_base=cfg.agent.apiBase or None,
            enable_memory=cfg.agent.enableMemory,
            allow_private=cfg.allowPrivate,
            allow_group=cfg.allowGroup,
            allow_unlisted=cfg.allowUnlisted,
            allowed_users=set(cfg.allowedUsers),
            allowed_groups=set(cfg.allowedGroups),
        ),
    )
    adapter = QQBotpyAdapter(
        hub=hub,
        account_id=cfg.accountId,
        bot_user_id=cfg.botUserId,
        dispatch_loop=loop,
    )
    return QQBotpyRuntime(
        app_id=cfg.appId,
        app_secret=cfg.appSecret,
        adapter=adapter,
        bot_user_id=cfg.botUserId,
        on_error=_mark_qqbot_runtime_error,
    )


def _set_qqbot_status(**updates: Any) -> None:
    _qqbot_status.update(updates)


def _mark_qqbot_runtime_error(exc: BaseException) -> None:
    _set_qqbot_status(
        running=False,
        message="qq-botpy runtime 启动失败",
        error=str(exc),
    )
