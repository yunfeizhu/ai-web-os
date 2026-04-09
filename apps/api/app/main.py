from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.api.v1 import settings as settings_router
from app.api.v1 import agents as agents_router
from app.api.v1 import memory as memory_router
from app.api.v1 import test as test_router
from app.api.v1 import knowledge as knowledge_router
from app.core.database import init_db
from app.core.knowledge import shutdown_knowledge_manager
from app.api.websocket import websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    try:
        yield
    finally:
        await shutdown_knowledge_manager()


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
    app.include_router(memory_router.router, prefix="/api/v1", tags=["memory"])
    app.include_router(test_router.router, prefix="/api/v1", tags=["test"])
    app.include_router(knowledge_router.router, prefix="/api/v1/knowledge", tags=["knowledge"])

    from fastapi import WebSocket
    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket_endpoint(websocket)

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": "0.2.0"}

    return app


app = create_app()
