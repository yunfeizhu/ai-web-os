from __future__ import annotations

import mimetypes

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.avatar_assets import resolve_avatar_asset_path, save_avatar_zip

router = APIRouter()


@router.get("/assets/{asset_path:path}")
async def get_avatar_asset(asset_path: str):
    try:
        target = resolve_avatar_asset_path(asset_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Avatar asset not found")

    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type)


@router.post("/live2d/zip")
async def upload_live2d_zip(file: UploadFile = File(...)):
    content = await file.read()

    try:
        return save_avatar_zip(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
