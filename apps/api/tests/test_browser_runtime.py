import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import pytest


def _load_browser_runtime_module():
    module_path = Path(__file__).resolve().parents[3] / "infra" / "browser-runtime" / "server.py"
    spec = importlib.util.spec_from_file_location("browser_runtime_server_under_test", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load browser runtime module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


browser_runtime = _load_browser_runtime_module()


class FakePage:
    def __init__(self):
        self.url = "about:blank"
        self.goto_calls: list[tuple[str, dict]] = []

    def is_closed(self):
        return False

    async def title(self):
        return "Fake Page"

    async def goto(self, url: str, **kwargs):
        self.goto_calls.append((url, kwargs))
        self.url = url
        return None


class FakeContext:
    def __init__(self, pages):
        self.pages = pages


def _runtime_with_active_page(page: FakePage):
    runtime = browser_runtime.BrowserRuntime()
    tab = browser_runtime.BrowserTab(id="tab-1", page=page)
    session = browser_runtime.BrowserSession(
        id="session-1",
        browser=object(),
        context=FakeContext([page]),
        tabs={tab.id: tab},
        active_tab_id=tab.id,
    )
    runtime.sessions[session.id] = session
    return runtime


def test_browser_runtime_rejects_non_web_navigation_urls():
    page = FakePage()
    runtime = _runtime_with_active_page(page)

    with pytest.raises(browser_runtime.RuntimeErrorMessage, match="http/https"):
        asyncio.run(runtime.navigate("session-1", "file:///etc/passwd"))

    assert page.goto_calls == []


def test_browser_runtime_normalizes_urls_without_scheme_to_https():
    page = FakePage()
    runtime = _runtime_with_active_page(page)

    asyncio.run(runtime.navigate("session-1", "example.com/path"))

    assert page.goto_calls[0][0] == "https://example.com/path"


def test_browser_runtime_does_not_load_global_storage_state_by_default(monkeypatch, tmp_path):
    storage_state = tmp_path / "default-storage-state.json"
    storage_state.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(browser_runtime, "STORAGE_STATE_PATH", storage_state)

    options = browser_runtime.BrowserRuntime()._build_context_options()

    assert "storage_state" not in options


def test_browser_runtime_cors_is_not_open_to_all_origins():
    cors_middleware = next(
        middleware
        for middleware in browser_runtime.app.user_middleware
        if middleware.cls.__name__ == "CORSMiddleware"
    )

    origins = cors_middleware.kwargs["allow_origins"]

    assert "*" not in origins
    assert "http://localhost:16080" in origins


def test_browser_runtime_dev_script_exposes_novnc_port():
    package_json = Path(__file__).resolve().parents[3] / "package.json"
    scripts = json.loads(package_json.read_text(encoding="utf-8"))["scripts"]

    assert "-p 16080:6080" in scripts["browser-runtime:dev"]


def test_browser_runtime_entrypoint_supports_vnc_password():
    entrypoint = (
        Path(__file__).resolve().parents[3]
        / "infra"
        / "browser-runtime"
        / "entrypoint.sh"
    ).read_text(encoding="utf-8")

    assert "BROWSER_VNC_PASSWORD" in entrypoint
    assert "-passwd" in entrypoint


def test_embedded_vnc_focuses_current_session_on_viewer_activity():
    embedded_vnc = (
        Path(__file__).resolve().parents[3]
        / "infra"
        / "browser-runtime"
        / "embedded_vnc.html"
    ).read_text(encoding="utf-8")

    assert "focusSession()" in embedded_vnc
    assert "/sessions/${encodeURIComponent(sessionId)}/focus" in embedded_vnc
    assert 'window.addEventListener("focus", focusSession)' in embedded_vnc
    assert 'screen.addEventListener("mouseenter", focusSession)' in embedded_vnc
    assert 'document.addEventListener("visibilitychange"' in embedded_vnc
