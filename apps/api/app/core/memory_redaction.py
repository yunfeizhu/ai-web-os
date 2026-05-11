"""Redaction helpers shared by memory ingestion paths."""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\-\s]{8,}\d)(?!\d)")
_SECRET_RE = re.compile(
    r"(?i)\b(?:[A-Z0-9_]*API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*['\"]?[^'\"\s,;]+"
)
_OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")


def redact_memory_text(text: str) -> str:
    redacted = str(text or "")
    redacted = _SECRET_RE.sub("[redacted-secret]", redacted)
    redacted = _OPENAI_KEY_RE.sub("[redacted-secret]", redacted)
    redacted = _EMAIL_RE.sub("[redacted-email]", redacted)
    redacted = _PHONE_RE.sub("[redacted-phone]", redacted)
    return redacted.strip()
