"""真实文件系统实现

Windows：虚拟根 "/" 映射到"此电脑"，盘符作为顶层目录（/C → C:\，/D → D:\）。
其他系统：虚拟根 "/" 映射到 FS_ROOT（默认用户主目录），沙箱隔离。

所有公开函数保持与原 DB 版本相同的签名（接受 db 参数但忽略），
确保 files.py / app_registry.py 无需修改。
"""
from __future__ import annotations

import asyncio
import base64
import mimetypes
import os
import platform
import posixpath
import shutil
import string
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"
WINDOWS_DOCUMENTS_ROOT = Path.home() / "Documents"
APP_DOCUMENTS_ROOT = WINDOWS_DOCUMENTS_ROOT / "AI Web OS"
APP_VIRTUAL_ROOTS = {
    "/Notes": APP_DOCUMENTS_ROOT / "Notes",
    "/Documents": APP_DOCUMENTS_ROOT / "Documents",
    "/Whiteboards": APP_DOCUMENTS_ROOT / "Whiteboards",
}
LINUX_DESKTOP_VIRTUAL_PATH = "/root/Desktop"
LINUX_DESKTOP_ROOT = Path(LINUX_DESKTOP_VIRTUAL_PATH)

# 非 Windows 系统的沙箱根目录（可通过环境变量覆盖）
FS_ROOT = Path(os.getenv("FS_ROOT", str(Path.home()))).resolve()

# ── 路径工具 ──────────────────────────────────────────────────────────────────


def normalize_path(path: str | None) -> str:
    raw = (path or "/").replace("\\", "/").strip()
    if not raw:
        return "/"
    if not raw.startswith("/"):
        raw = f"/{raw}"
    normalized = posixpath.normpath(raw)
    return normalized if normalized.startswith("/") else f"/{normalized}"


def parent_path(path: str) -> str:
    normalized = normalize_path(path)
    if normalized == "/":
        return "/"
    p = posixpath.dirname(normalized)
    return p if p.startswith("/") else f"/{p}"


def join_path(base: str, name: str) -> str:
    base_path = normalize_path(base)
    clean_name = (name or "").strip().strip("/")
    if not clean_name:
        return base_path
    return f"/{clean_name}" if base_path == "/" else f"{base_path}/{clean_name}"


def get_desktop_directory(home: Path | None = None) -> Path:
    if IS_WINDOWS:
        return (home or Path.home()) / "Desktop"
    return LINUX_DESKTOP_ROOT


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_non_windows_desktop_path(normalized: str) -> Path | None:
    if normalized != LINUX_DESKTOP_VIRTUAL_PATH and not normalized.startswith(
        f"{LINUX_DESKTOP_VIRTUAL_PATH}/"
    ):
        return None

    suffix = normalized[len(LINUX_DESKTOP_VIRTUAL_PATH):].lstrip("/")
    root = LINUX_DESKTOP_ROOT.resolve()
    real = (root / suffix).resolve() if suffix else root
    if real != root and not _is_relative_to(real, root):
        raise ValueError(f"路径穿越攻击被拦截: {normalized}")
    return real


def _get_windows_drives() -> list[str]:
    """返回 Windows 上所有可用盘符（大写字母列表，如 ['C', 'D', 'E']）。"""
    try:
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        return [l for l in string.ascii_uppercase if bitmask & (1 << (ord(l) - ord("A")))]
    except Exception:
        return ["C"]


def _resolve_windows_app_path(virtual_path: str) -> tuple[str, Path] | None:
    normalized = normalize_path(virtual_path)
    for virtual_root, real_root in APP_VIRTUAL_ROOTS.items():
        if normalized == virtual_root or normalized.startswith(f"{virtual_root}/"):
            suffix = normalized[len(virtual_root):].lstrip("/")
            target = (real_root / suffix).resolve() if suffix else real_root.resolve()
            if not str(target).startswith(str(real_root)):
                raise ValueError(f"路径穿越攻击被拦截: {virtual_path}")
            return virtual_root, target
    return None


def _to_real(virtual_path: str) -> Path:
    """虚拟路径 → 真实磁盘路径。

    Windows：/C/foo → C:\\foo，/ 是虚拟根（无真实路径，抛出 ValueError）。
    其他系统：/ → FS_ROOT，沙箱隔离。
    """
    normalized = normalize_path(virtual_path)

    if IS_WINDOWS:
        if normalized == "/":
            raise ValueError("Windows 虚拟根无对应真实路径")
        app_mapping = _resolve_windows_app_path(normalized)
        if app_mapping is not None:
            return app_mapping[1]
        parts = normalized.lstrip("/").split("/", 1)
        drive = parts[0]
        if len(drive) == 1 and drive.isalpha():
            rest = parts[1].replace("/", "\\") if len(parts) > 1 else ""
            real = Path(f"{drive.upper()}:\\{rest}").resolve()
            # 防止路径穿越到其他盘符
            if real.drive.upper()[0] != drive.upper():
                raise ValueError(f"路径穿越攻击被拦截: {virtual_path}")
            return real
        raise ValueError(f"非法 Windows 虚拟路径（首段应为盘符）: {virtual_path}")

    desktop_real = _resolve_non_windows_desktop_path(normalized)
    if desktop_real is not None:
        return desktop_real

    # 非 Windows：沙箱隔离
    rel = normalized.lstrip("/")
    real = (FS_ROOT / rel).resolve() if rel else FS_ROOT.resolve()
    if not str(real).startswith(str(FS_ROOT)):
        raise ValueError(f"路径穿越攻击被拦截: {virtual_path}")
    return real


def _to_virtual(real_path: Path) -> str:
    """真实磁盘路径 → 虚拟路径。"""
    if IS_WINDOWS:
        resolved = real_path.resolve()
        for virtual_root, real_root in APP_VIRTUAL_ROOTS.items():
            try:
                rel = resolved.relative_to(real_root)
            except ValueError:
                continue
            rel_text = str(rel).replace("\\", "/").strip("/")
            return f"{virtual_root}/{rel_text}" if rel_text else virtual_root
        drive = real_path.drive  # 形如 "C:"
        if drive:
            letter = drive[0].upper()
            rest = str(real_path)[len(drive):].replace("\\", "/").strip("/")
            return f"/{letter}/{rest}" if rest else f"/{letter}"

    resolved = real_path.resolve()
    desktop_root = LINUX_DESKTOP_ROOT.resolve()
    if resolved == desktop_root or _is_relative_to(resolved, desktop_root):
        rel = resolved.relative_to(desktop_root)
        rel_text = str(rel).replace("\\", "/").strip("/")
        return join_path(LINUX_DESKTOP_VIRTUAL_PATH, rel_text)

    rel = resolved.relative_to(FS_ROOT)
    return "/" + str(rel).replace("\\", "/")


def _path_to_id(virtual_path: str) -> str:
    """虚拟路径 → URL-safe base64 ID（可逆）。"""
    return base64.urlsafe_b64encode(virtual_path.encode()).decode().rstrip("=")


def _id_to_path(entry_id: str) -> str:
    """base64 ID → 虚拟路径。"""
    pad = (4 - len(entry_id) % 4) % 4
    return base64.urlsafe_b64decode((entry_id + "=" * pad).encode()).decode()


# ── FileNode 数据类（替换 ORM FileEntry） ─────────────────────────────────────


@dataclass(slots=True)
class FileNode:
    id: str
    name: str
    path: str
    parent_path: str
    kind: str           # "file" | "dir"
    mime_type: str | None
    size: int
    created_at: str     # ISO 格式字符串
    updated_at: str     # ISO 格式字符串
    extra: dict = field(default_factory=dict)


def _make_node(real: Path, virtual: str) -> FileNode:
    try:
        stat = real.stat()
        is_dir = real.is_dir()
        size = 0 if is_dir else stat.st_size
        created_at = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat()
        updated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    except (PermissionError, OSError):
        is_dir = True
        size = 0
        now = datetime.now(tz=timezone.utc).isoformat()
        created_at = updated_at = now
    # Windows 盘符根（如 C:\）的 name 为空，用 "C:" 替代
    node_name = real.name or (real.drive if IS_WINDOWS and real.drive else "")
    return FileNode(
        id=_path_to_id(virtual),
        name=node_name,
        path=virtual,
        parent_path=parent_path(virtual),
        kind="dir" if is_dir else "file",
        mime_type="inode/directory" if is_dir else (
            mimetypes.guess_type(real.name)[0] or "application/octet-stream"
        ),
        size=size,
        created_at=created_at,
        updated_at=updated_at,
    )


def serialize_entry(entry: FileNode) -> dict:
    return {
        "id": entry.id,
        "name": entry.name,
        "path": entry.path,
        "parent_path": entry.parent_path,
        "kind": entry.kind,
        "mime_type": entry.mime_type,
        "size": entry.size,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "extra": entry.extra or {},
    }


# ── 同步 I/O 辅助（在线程池中运行，避免阻塞事件循环） ─────────────────────────


def _sync_ensure_dirs() -> None:
    if IS_WINDOWS:
        APP_DOCUMENTS_ROOT.mkdir(parents=True, exist_ok=True)
        for real_root in APP_VIRTUAL_ROOTS.values():
            real_root.mkdir(parents=True, exist_ok=True)
        return
    FS_ROOT.mkdir(parents=True, exist_ok=True)


def _sync_write_bytes(real: Path, data: bytes) -> None:
    real.parent.mkdir(parents=True, exist_ok=True)
    real.write_bytes(data)


def _sync_write_text(real: Path, content: str) -> None:
    real.parent.mkdir(parents=True, exist_ok=True)
    # newline="" 防止 Windows 将 \n 转换为 \r\n
    with open(real, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def _sync_move(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def _sync_copy(src: Path, dst: Path, is_dir: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if is_dir:
        shutil.copytree(str(src), str(dst))
    else:
        shutil.copy2(str(src), str(dst))


def _unique_child_path(parent: Path, name: str) -> Path:
    candidate = parent / name
    if not candidate.exists():
        return candidate

    idx = 1
    while True:
        next_candidate = parent / f"{name} ({idx})"
        if not next_candidate.exists():
            return next_candidate
        idx += 1


async def _run(func, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, func, *args)


# ── 初始化 ─────────────────────────────────────────────────────────────────────


async def ensure_default_directories(db=None) -> None:
    """确保沙箱根目录与默认子目录存在于真实文件系统。"""
    await _run(_sync_ensure_dirs)


# ── 查询 ──────────────────────────────────────────────────────────────────────


async def get_entry_by_id(db, entry_id: str) -> FileNode | None:
    try:
        virtual = _id_to_path(entry_id)
    except Exception:
        return None
    return await get_entry_by_path(db, virtual)


def _windows_root_node() -> FileNode:
    now = datetime.now(tz=timezone.utc).isoformat()
    return FileNode(
        id=_path_to_id("/"),
        name="此电脑",
        path="/",
        parent_path="/",
        kind="dir",
        mime_type="inode/directory",
        size=0,
        created_at=now,
        updated_at=now,
    )


def _windows_drive_nodes() -> list[FileNode]:
    """将每个可用盘符包装为 FileNode。"""
    now = datetime.now(tz=timezone.utc).isoformat()
    nodes = []
    for letter in _get_windows_drives():
        virtual = f"/{letter}"
        nodes.append(FileNode(
            id=_path_to_id(virtual),
            name=f"本地磁盘 ({letter}:)",
            path=virtual,
            parent_path="/",
            kind="dir",
            mime_type="inode/directory",
            size=0,
            created_at=now,
            updated_at=now,
            extra={"sort_group": 20},
        ))
    return nodes


def _windows_special_directory_nodes() -> list[FileNode]:
    candidates = [
        ("桌面", Path.home() / "Desktop"),
        ("下载", Path.home() / "Downloads"),
    ]
    nodes: list[FileNode] = []
    for label, real in candidates:
        try:
            resolved = real.resolve()
        except OSError:
            continue
        if not resolved.exists() or not resolved.is_dir():
            continue
        node = _make_node(resolved, _to_virtual(resolved))
        node.name = label
        node.extra = {
            **node.extra,
            "shortcut": True,
            "target_path": node.path,
            "sort_group": 10,
        }
        nodes.append(node)
    return nodes


async def get_entry_by_path(db, path: str) -> FileNode | None:
    normalized = normalize_path(path)
    if IS_WINDOWS and normalized == "/":
        return _windows_root_node()
    try:
        real = _to_real(normalized)
    except ValueError:
        return None
    if not real.exists():
        return None
    return _make_node(real, normalized)


async def list_entries(db, path: str = "/") -> list[FileNode]:
    await ensure_default_directories()
    normalized = normalize_path(path)

    # Windows 虚拟根：返回所有盘符
    if IS_WINDOWS and normalized == "/":
        return _windows_drive_nodes()

    try:
        real = _to_real(normalized)
    except ValueError:
        return []
    if not real.exists() or not real.is_dir():
        return []

    def _scan():
        children = []
        try:
            for item in real.iterdir():
                try:
                    item.stat()
                    children.append(item)
                except (PermissionError, OSError):
                    pass
        except (PermissionError, OSError):
            pass
        children.sort(key=lambda p: (not p.is_dir(), p.name.lower()))
        return children

    children = await _run(_scan)
    return [_make_node(c, _to_virtual(c)) for c in children]


async def list_all_directories(db) -> list[FileNode]:
    """返回顶层目录列表，用于构建左侧目录树。

    Windows：返回所有盘符节点。
    其他系统：返回 FS_ROOT 下的一级子目录。
    """
    await ensure_default_directories()

    if IS_WINDOWS:
        return _windows_drive_nodes()

    def _scan():
        result = []
        try:
            for item in FS_ROOT.iterdir():
                try:
                    if item.is_dir():
                        result.append(item)
                except (PermissionError, OSError):
                    pass
        except (PermissionError, OSError):
            pass
        return sorted(result, key=lambda p: p.name.lower())

    dirs = await _run(_scan)
    return [_make_node(p, _to_virtual(p)) for p in dirs]


# ── 写操作 ─────────────────────────────────────────────────────────────────────


async def create_folder(db, parent: str, name: str) -> FileNode:
    destination = join_path(parent, name)
    if destination == "/":
        raise ValueError("根目录已存在。")
    real = _to_real(destination)
    if real.exists():
        raise ValueError("同名文件或目录已存在。")
    await _run(lambda: real.mkdir(parents=True))
    return _make_node(real, destination)


async def create_desktop_folder(db, name: str = "新建文件夹") -> FileNode:
    clean_name = (name or "").strip() or "新建文件夹"
    if "/" in clean_name or "\\" in clean_name:
        raise ValueError("文件夹名称不能包含路径分隔符。")

    desktop = get_desktop_directory()
    real = _unique_child_path(desktop, clean_name)
    await _run(lambda: real.mkdir(parents=True))
    return _make_node(real, _to_virtual(real))


async def save_upload(
    db,
    parent: str,
    filename: str,
    data: bytes,
    mime_type: str | None = None,
) -> FileNode:
    destination = join_path(parent, filename)
    real = _to_real(destination)

    # 同名冲突：自动追加 (1), (2)…
    if real.exists():
        stem = Path(real.name).stem
        suf = "".join(Path(real.name).suffixes)
        idx = 1
        while True:
            candidate = real.parent / f"{stem} ({idx}){suf}"
            if not candidate.exists():
                real = candidate
                destination = _to_virtual(real)
                break
            idx += 1

    await _run(_sync_write_bytes, real, data)
    return _make_node(real, destination)


async def save_text_file(
    db,
    path: str,
    content: str,
    mime_type: str = "text/markdown",
    overwrite: bool = True,
) -> FileNode:
    normalized = normalize_path(path)
    real = _to_real(normalized)
    if not overwrite and real.exists():
        raise ValueError("同名文件或目录已存在。")
    await _run(_sync_write_text, real, content)
    return _make_node(real, normalized)


async def save_binary_file(
    db,
    path: str,
    content: bytes,
    overwrite: bool = True,
) -> FileNode:
    normalized = normalize_path(path)
    real = _to_real(normalized)
    if not overwrite and real.exists():
        raise ValueError("同名文件或目录已存在。")
    await _run(_sync_write_bytes, real, content)
    return _make_node(real, normalized)


async def read_entry_bytes(entry: FileNode) -> bytes:
    if entry.kind != "file":
        raise ValueError("目录不支持读取内容。")
    real = _to_real(entry.path)
    return await _run(real.read_bytes)


async def read_entry_text(entry: FileNode) -> str:
    data = await read_entry_bytes(entry)
    return data.decode("utf-8", errors="replace")


async def rename_entry(db, entry: FileNode, new_name: str) -> FileNode:
    destination = join_path(entry.parent_path, new_name)
    if destination == entry.path:
        return entry
    real_src = _to_real(entry.path)
    real_dst = _to_real(destination)
    if real_dst.exists():
        raise ValueError("目标名称已存在。")
    await _run(real_src.rename, real_dst)
    return _make_node(real_dst, destination)


async def move_entry(db, entry: FileNode, destination_dir: str) -> FileNode:
    target_dir = normalize_path(destination_dir)
    destination = join_path(target_dir, entry.name)
    if entry.kind == "dir" and target_dir.startswith(f"{entry.path}/"):
        raise ValueError("不能把目录移动到自己的子目录中。")
    real_src = _to_real(entry.path)
    real_dst = _to_real(destination)
    if real_dst.exists():
        raise ValueError("目标目录下已存在同名条目。")
    await _run(_sync_move, real_src, real_dst)
    return _make_node(real_dst, destination)


async def copy_entry(
    db,
    entry: FileNode,
    destination_dir: str,
    new_name: str | None = None,
) -> FileNode:
    target_dir = normalize_path(destination_dir)
    destination = join_path(target_dir, new_name or entry.name)
    real_src = _to_real(entry.path)
    real_dst = _to_real(destination)
    if real_dst.exists():
        raise ValueError("目标目录下已存在同名条目。")
    await _run(_sync_copy, real_src, real_dst, entry.kind == "dir")
    return _make_node(real_dst, destination)


async def delete_entry(db, entry: FileNode) -> None:
    real = _to_real(entry.path)
    if entry.kind == "dir":
        await _run(shutil.rmtree, str(real))
    else:
        await _run(real.unlink)


async def build_directory_tree(db) -> list[dict]:
    dirs = await list_all_directories(db)
    if IS_WINDOWS:
        dirs = [*_windows_special_directory_nodes(), *dirs]

    nodes: dict[str, dict] = {"/": {"name": "Root", "path": "/", "children": [], "sort_group": 0}}
    for d in dirs:
        nodes[d.path] = {
            "name": d.name,
            "path": d.path,
            "children": [],
            "sort_group": d.extra.get("sort_group", 99),
        }
    for d in dirs:
        container = nodes.get(d.parent_path, nodes["/"])
        container["children"].append(nodes[d.path])

    def _sort(node: dict) -> None:
        node["children"].sort(key=lambda c: (c.get("sort_group", 99), c["name"].lower()))
        for child in node["children"]:
            _sort(child)

    _sort(nodes["/"])
    for node in nodes.values():
        node.pop("sort_group", None)
    return nodes["/"]["children"]
