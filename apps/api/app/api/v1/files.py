from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import quote

from app.core.database import get_db
from app.core.file_manager import (
    build_directory_tree,
    copy_entry,
    create_desktop_folder,
    create_folder,
    delete_entry,
    get_entry_by_id,
    get_entry_by_path,
    list_entries,
    move_entry,
    read_entry_bytes,
    read_entry_text,
    rename_entry,
    save_binary_file,
    save_text_file,
    save_upload,
    serialize_entry,
)

router = APIRouter()


def build_content_disposition(filename: str, disposition: str = "inline") -> str:
    safe_ascii = (
        filename.encode("ascii", "ignore").decode().replace("\\", "_").replace('"', "_").strip()
    )
    if not safe_ascii:
        safe_ascii = "download"
    encoded = quote(filename, safe="")
    return f"{disposition}; filename=\"{safe_ascii}\"; filename*=UTF-8''{encoded}"


class CreateFolderRequest(BaseModel):
    parent: str = "/"
    name: str


class CreateDesktopFolderRequest(BaseModel):
    name: str = "新建文件夹"


class UpdateContentRequest(BaseModel):
    path: str
    content: str
    mime_type: str = "text/plain"


class CreateTextFileRequest(BaseModel):
    parent: str = "/"
    name: str
    content: str = ""
    mime_type: str = "text/plain"


class UpdateBinaryContentRequest(BaseModel):
    path: str
    content_base64: str


class RenameEntryRequest(BaseModel):
    name: str


class MoveEntryRequest(BaseModel):
    entry_id: str
    destination_dir: str


class CopyEntryRequest(BaseModel):
    entry_id: str
    destination_dir: str
    new_name: str | None = None


@router.get("")
async def get_files(path: str = Query(default="/"), db: AsyncSession = Depends(get_db)):
    rows = await list_entries(db, path)
    return {"path": path, "entries": [serialize_entry(row) for row in rows]}


@router.get("/tree")
async def get_files_tree(db: AsyncSession = Depends(get_db)):
    from app.core.file_manager import IS_WINDOWS, FS_ROOT
    root_name = "此电脑" if IS_WINDOWS else FS_ROOT.name
    return {"tree": await build_directory_tree(db), "root_name": root_name}


@router.get("/resolve")
async def resolve_file(path: str, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_path(db, path)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    return serialize_entry(entry)


@router.get("/content")
async def get_file_content(path: str, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_path(db, path)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    if entry.kind != "file":
        raise HTTPException(status_code=400, detail="Directories do not have text content")
    return {
        "entry": serialize_entry(entry),
        "content": await read_entry_text(entry),
    }


@router.post("/folders")
async def make_folder(data: CreateFolderRequest, db: AsyncSession = Depends(get_db)):
    try:
        entry = await create_folder(db, data.parent, data.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.post("/desktop/folders")
async def make_desktop_folder(
    data: CreateDesktopFolderRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        entry = await create_desktop_folder(db, data.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.post("/text-files")
async def create_text_file(data: CreateTextFileRequest, db: AsyncSession = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="File name is required")
    if "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="File name cannot contain path separators")

    if not name.lower().endswith(".txt"):
        name = f"{name}.txt"

    parent = data.parent.rstrip("/") or "/"
    path = f"{parent}/{name}" if parent != "/" else f"/{name}"

    try:
        entry = await save_text_file(
            db,
            path,
            data.content,
            mime_type=data.mime_type,
            overwrite=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.post("/upload")
async def upload_file(
    path: str = Query(default="/"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    try:
        entry = await save_upload(
            db,
            path,
            file.filename or "untitled",
            data,
            mime_type=file.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.put("/content")
async def put_file_content(data: UpdateContentRequest, db: AsyncSession = Depends(get_db)):
    try:
        entry = await save_text_file(db, data.path, data.content, mime_type=data.mime_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.put("/binary-content")
async def put_binary_file_content(
    data: UpdateBinaryContentRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        content = base64.b64decode(data.content_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 content") from exc

    try:
        entry = await save_binary_file(db, data.path, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(entry)


@router.post("/move")
async def move_file(data: MoveEntryRequest, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_id(db, data.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    try:
        moved = await move_entry(db, entry, data.destination_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(moved)


@router.post("/copy")
async def copy_file(data: CopyEntryRequest, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_id(db, data.entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    try:
        copied = await copy_entry(db, entry, data.destination_dir, data.new_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(copied)


@router.patch("/{entry_id}")
async def rename_file(
    entry_id: str,
    data: RenameEntryRequest,
    db: AsyncSession = Depends(get_db),
):
    entry = await get_entry_by_id(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    try:
        renamed = await rename_entry(db, entry, data.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_entry(renamed)


@router.get("/{entry_id}")
async def get_file(entry_id: str, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_id(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return serialize_entry(entry)


@router.get("/{entry_id}/download")
async def download_file(entry_id: str, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_id(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.kind != "file":
        raise HTTPException(status_code=400, detail="Cannot download a directory")

    return Response(
        content=await read_entry_bytes(entry),
        media_type=entry.mime_type or "application/octet-stream",
        headers={"Content-Disposition": build_content_disposition(entry.name)},
    )


@router.delete("/{entry_id}")
async def remove_file(entry_id: str, db: AsyncSession = Depends(get_db)):
    entry = await get_entry_by_id(db, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    await delete_entry(db, entry)
    return {"status": "deleted"}
