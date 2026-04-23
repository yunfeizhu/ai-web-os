"""User-facing error messages for provider and agent failures."""

from __future__ import annotations


def _exception_text(exc: BaseException) -> str:
    parts: list[str] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        parts.append(f"{type(current).__name__}: {current}")
        current = current.__cause__ or current.__context__
    return "\n".join(parts)


def user_facing_error_message(exc: BaseException) -> str:
    """Map low-level SDK/provider exceptions to short, actionable copy."""
    text = _exception_text(exc)
    normalized = text.lower()

    if "invalid temperature" in normalized or (
        "temperature" in normalized and "only 1 is allowed" in normalized
    ):
        return (
            "当前模型不支持自定义 temperature 参数。系统已为常见 Kimi K2 模型做自动兼容，"
            "请重试；如果仍出现，请检查模型配置里的模型 ID 是否填写正确。"
        )

    if "thinking is enabled" in normalized and "reasoning_content" in normalized:
        return (
            "当前思考模型需要完整的思考历史。本应用已支持思考历史格式，请重试本轮消息；"
            "如果这是旧会话残留，可以新开一个对话后继续。"
        )

    if any(
        marker in normalized
        for marker in (
            "connection error",
            "httpsconnectionpool",
            "max retries exceeded",
            "ssleoferror",
            "eof occurred in violation of protocol",
            "connection reset",
            "connection refused",
            "network is unreachable",
            "failed to establish a new connection",
            "name resolution",
            "getaddrinfo",
            "connect timeout",
            "read timeout",
            "timeout",
        )
    ):
        return (
            "网络连接中断，或模型服务/API Base 暂时不可达。请检查网络、代理和模型 API Base，"
            "恢复后重试即可。"
        )

    if any(marker in normalized for marker in ("unauthorized", "invalid api key", "401")):
        return "模型服务鉴权失败。请检查当前模型配置里的 API Key 是否正确、是否有该模型权限。"

    if any(marker in normalized for marker in ("rate limit", "too many requests", "429")):
        return "模型服务正在限流或繁忙。请稍等一会儿再重试，或切换到其他可用模型。"

    if any(marker in normalized for marker in ("model not found", "404", "not found")):
        return "模型 ID 或 API Base 可能不匹配。请检查模型配置中的模型名称和服务地址。"

    if any(marker in normalized for marker in ("context length", "maximum context", "too many tokens")):
        return "这轮对话上下文过长，模型暂时无法处理。请重试，或新开对话继续。"

    return "模型调用失败了。请稍后重试；如果连续出现，请检查模型配置、网络和后端日志。"
