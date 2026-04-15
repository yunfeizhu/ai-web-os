"""Knowledge base management API."""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.core.knowledge import extract_text, get_knowledge_manager, init_knowledge_manager
from app.models.knowledge import KnowledgeDocument

router = APIRouter()

ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}


class InitKnowledgeRequest(BaseModel):
    embedder_model: str
    embedder_api_key: str | None = None
    embedder_base_url: str | None = None
    qdrant_url: str = "http://127.0.0.1:16333"


class AddTextRequest(BaseModel):
    title: str
    content: str


class DocumentResponse(BaseModel):
    id: str
    title: str
    source_type: str
    source_url: str | None
    chunk_count: int
    status: str
    error_msg: str | None
    created_at: str


@router.post("/init")
async def init_knowledge(req: InitKnowledgeRequest):
    settings = get_settings()
    manager = init_knowledge_manager(
        embedder_model=req.embedder_model,
        embedder_api_key=req.embedder_api_key,
        embedder_api_base=req.embedder_base_url,
        qdrant_url=req.qdrant_url,
        max_concurrent_jobs=settings.knowledge_max_concurrent_jobs,
    )
    return {
        "status": "ok",
        "collection": manager.COLLECTION,
        "max_concurrent_jobs": manager.max_concurrent_jobs,
        "hybrid_search": True,
        "restart_recovery": True,
    }


@router.get("/status")
async def knowledge_status():
    manager = get_knowledge_manager()
    return {
        "initialized": manager is not None,
        "collection": manager.COLLECTION if manager else None,
        "max_concurrent_jobs": manager.max_concurrent_jobs if manager else 0,
        "active_jobs": manager.active_jobs if manager else 0,
        "queued_jobs": manager.queue_size if manager else 0,
        "hybrid_search": True,
        "restart_recovery": True,
    }


@router.get("/documents", response_model=list[DocumentResponse])
async def list_documents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc())
    )
    documents = result.scalars().all()
    return [
        DocumentResponse(
            id=document.id,
            title=document.title,
            source_type=document.source_type,
            source_url=document.source_url,
            chunk_count=document.chunk_count,
            status=document.status,
            error_msg=document.error_msg,
            created_at=document.created_at.isoformat(),
        )
        for document in documents
    ]


@router.post("/documents", response_model=DocumentResponse)
async def add_text_document(req: AddTextRequest, db: AsyncSession = Depends(get_db)):
    manager = get_knowledge_manager()
    if not manager:
        raise HTTPException(status_code=400, detail="Knowledge base is not initialized.")

    try:
        doc_id, document = await manager.create_document(
            title=req.title,
            content=req.content,
            source_type="text",
            db=db,
        )
        await manager.enqueue_document_processing(
            doc_id=doc_id,
            title=req.title,
            content=req.content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add document: {exc}") from exc

    return DocumentResponse(
        id=document.id,
        title=document.title,
        source_type=document.source_type,
        source_url=document.source_url,
        chunk_count=document.chunk_count,
        status=document.status,
        error_msg=document.error_msg,
        created_at=document.created_at.isoformat(),
    )


@router.post("/documents/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    manager = get_knowledge_manager()
    if not manager:
        raise HTTPException(status_code=400, detail="Knowledge base is not initialized.")

    filename = file.filename or "unknown"
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Supported types: {sorted(ALLOWED_EXTENSIONS)}",
        )

    data = await file.read()

    try:
        content = await extract_text(data, filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to extract text: {exc}") from exc

    if not content.strip():
        raise HTTPException(status_code=422, detail="Document content is empty.")

    object_name = f"kb/{uuid.uuid4()}/{filename}"

    try:
        # MinIO 上传为灾备用途，raw_content 已存 DB，无需阻塞请求
        asyncio.create_task(manager.store_file_source(data, object_name))
        doc_id, document = await manager.create_document(
            title=filename,
            content=content,
            source_type="file",
            source_url=object_name,
            db=db,
        )
        await manager.enqueue_document_processing(
            doc_id=doc_id,
            title=filename,
            content=content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {exc}") from exc

    return DocumentResponse(
        id=document.id,
        title=document.title,
        source_type=document.source_type,
        source_url=document.source_url,
        chunk_count=document.chunk_count,
        status=document.status,
        error_msg=document.error_msg,
        created_at=document.created_at.isoformat(),
    )


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_knowledge_manager()
    if not manager:
        raise HTTPException(status_code=400, detail="Knowledge base is not initialized.")

    result = await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")

    await manager.delete_document(doc_id, db)
    return {"status": "deleted"}


@router.get("/search")
async def search_knowledge(q: str, limit: int = 5):
    manager = get_knowledge_manager()
    if not manager:
        raise HTTPException(status_code=400, detail="Knowledge base is not initialized.")

    results = await manager.search(q, limit=limit)
    return {"results": results}
