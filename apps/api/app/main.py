from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.api.v1 import settings as settings_router
from app.api.v1 import agents as agents_router
from app.api.v1 import apps as apps_router
from app.api.v1 import files as files_router
from app.api.v1 import memory as memory_router
from app.api.v1 import test as test_router
from app.api.v1 import knowledge as knowledge_router
from app.api.v1 import browser as browser_router
from app.api.v1 import calendar as calendar_router
from app.api.v1 import mail as mail_router
from app.api.v1 import office as office_router
from app.api.v1 import skills as skills_router
from app.api.v1 import extensions as extensions_router
from app.core.database import init_db
from app.core.app_registry import get_app_registry, shutdown_app_registry
from app.core.agent_graph import init_checkpointer, shutdown_checkpointer
from app.core.browser_session import get_browser_session_manager
from app.core.knowledge import shutdown_knowledge_manager
from app.core.file_manager import ensure_default_directories, FS_ROOT
from app.api.websocket import websocket_endpoint


def _setup_trace_instrumentation() -> None:
    """Configure optional LLM trace backends based on environment settings.

    Supported backends (activated only when the corresponding env var is set):
    - Arize Phoenix (OpenTelemetry): TRACE_PHOENIX_ENDPOINT
    - LangSmith: TRACE_LANGSMITH_API_KEY
    """
    import os
    cfg = get_settings()

    # ── Arize Phoenix ──────────────────────────────────────────────────────────
    if cfg.trace_phoenix_endpoint:
        try:
            from openinference.instrumentation.litellm import LiteLLMInstrumentor  # type: ignore[import]
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # type: ignore[import]
            from opentelemetry.sdk import trace as trace_sdk  # type: ignore[import]
            from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # type: ignore[import]

            tracer_provider = trace_sdk.TracerProvider()
            tracer_provider.add_span_processor(
                SimpleSpanProcessor(
                    OTLPSpanExporter(endpoint=cfg.trace_phoenix_endpoint)
                )
            )
            LiteLLMInstrumentor().instrument(tracer_provider=tracer_provider)
            print(f"[Trace] ✓ Arize Phoenix instrumentation active → {cfg.trace_phoenix_endpoint}")
        except ImportError:
            print(
                "[Trace] Phoenix endpoint set but openinference-instrumentation-litellm "
                "not installed. Run: pip install openinference-instrumentation-litellm "
                "opentelemetry-exporter-otlp-proto-http"
            )

    # ── LangSmith ─────────────────────────────────────────────────────────────
    if cfg.trace_langsmith_api_key:
        os.environ.setdefault("LANGCHAIN_API_KEY", cfg.trace_langsmith_api_key)
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
        os.environ.setdefault("LANGCHAIN_PROJECT", cfg.trace_langsmith_project)
        print(f"[Trace] ✓ LangSmith tracing active (project: {cfg.trace_langsmith_project})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_trace_instrumentation()
    await init_db()
    await ensure_default_directories()
    print(f"[FileSystem] 沙箱根目录: {FS_ROOT}")
    get_app_registry()
    await init_checkpointer()
    if get_settings().browser_session_enabled:
        await get_browser_session_manager().startup()
    try:
        yield
    finally:
        await get_browser_session_manager().shutdown()
        await shutdown_app_registry()
        await shutdown_knowledge_manager()
        await shutdown_checkpointer()


def create_app() -> FastAPI:
    config = get_settings()

    app = FastAPI(
        title="AI-Native OS API",
        version="0.2.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(settings_router.router, prefix="/api/v1/settings", tags=["settings"])
    app.include_router(agents_router.router, prefix="/api/v1/agents", tags=["agents"])
    app.include_router(apps_router.router, prefix="/api/v1/apps", tags=["apps"])
    app.include_router(files_router.router, prefix="/api/v1/files", tags=["files"])
    app.include_router(memory_router.router, prefix="/api/v1", tags=["memory"])
    app.include_router(test_router.router, prefix="/api/v1", tags=["test"])
    app.include_router(knowledge_router.router, prefix="/api/v1/knowledge", tags=["knowledge"])
    app.include_router(browser_router.router, prefix="/api/v1/browser", tags=["browser"])
    app.include_router(calendar_router.router, prefix="/api/v1/calendar", tags=["calendar"])
    app.include_router(mail_router.router, prefix="/api/v1/mail", tags=["mail"])
    app.include_router(office_router.router, prefix="/api/v1/office", tags=["office"])
    app.include_router(skills_router.router, prefix="/api/v1/skills", tags=["skills"])
    app.include_router(extensions_router.router, prefix="/api/v1/extensions", tags=["extensions"])

    from fastapi import WebSocket
    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket_endpoint(websocket)

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": "0.2.0"}

    return app


app = create_app()
