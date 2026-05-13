from io import BytesIO

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import avatar as avatar_api


def _client(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))

    app = FastAPI()
    app.include_router(avatar_api.router, prefix="/api/v1/avatar")

    return TestClient(app), home


def test_avatar_asset_files_are_served_from_user_home(monkeypatch, tmp_path):
    client, home = _client(monkeypatch, tmp_path)
    model_file = home / "avatar" / "live2d" / "mao_pro_zh" / "runtime" / "mao_pro.model3.json"
    model_file.parent.mkdir(parents=True)
    model_file.write_text('{"Version": 3}', encoding="utf-8")

    response = client.get("/api/v1/avatar/assets/live2d/mao_pro_zh/runtime/mao_pro.model3.json")

    assert response.status_code == 200
    assert response.text == '{"Version": 3}'


def test_avatar_asset_route_blocks_path_traversal(monkeypatch, tmp_path):
    client, home = _client(monkeypatch, tmp_path)
    leaked_file = home / "mcp.json"
    leaked_file.parent.mkdir(parents=True)
    leaked_file.write_text("secret", encoding="utf-8")

    response = client.get("/api/v1/avatar/assets/%2E%2E/mcp.json")

    assert response.status_code == 400


def test_avatar_zip_upload_is_saved_under_user_home(monkeypatch, tmp_path):
    client, home = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/v1/avatar/live2d/zip",
        files={"file": ("mao.zip", BytesIO(b"zip-content"), "application/zip")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "name": "mao.zip",
        "path": "live2d/uploads/mao.zip",
        "url": "/avatar/assets/live2d/uploads/mao.zip",
    }
    assert (home / "avatar" / "live2d" / "uploads" / "mao.zip").read_bytes() == b"zip-content"
