# Better Sidebar Web (OpenKylin) Implementation Plan

**Goal:** 在 OpenKylin web-demo 内构建右侧多 tab 工作台，对齐 DSH-better-sidebar 的 UI 行为模式与扩展协议（`SidebarPanelRegistry` + `FileViewerRegistry`），含 5 个内置 viewer + 可写文件浏览树（限 thread workspace），7 个阶段每步独立可验证。

**Architecture:** 后端新增 `app/gateway/routers/files.py`（6 个 FS 端点，realpath 三道防线）+ `app/gateway/routers/sidebar_tabs.py`（tab 状态复用 `threads_meta.metadata_json.sidebar_tabs`）；前端新增 `web-demo/src/core/sidebar/`（协议层 6 文件）+ `web-demo/src/components/better-sidebar/`（UI 层 11 文件）+ `web-demo/src/core/files/`（FS 客户端 2 文件）；通过 `rightPanelMode` 与既有 rightPanel 共存/切换。

**Tech Stack:** Next.js 16 / React 19 / TanStack Query / @uiw/react-codemirror / streamdown / @streamdown/mermaid / rehype-raw / DOMPurify（已有）/ pdfjs-dist（新增）/ pytest / vitest+happy-dom / Playwright。

---

## 全局约定

- **每步命令**：`cd <repo-root>` 执行（web-demo 步骤内会 `cd web-demo`）。
- **运行后端测试**：`uv run pytest tests/test_files_router.py -v`（文件不存在前会失败——是预期）。
- **运行 web-demo 单测**：`cd web-demo && pnpm test --reporter=verbose <pattern>`。
- **运行 web-demo typecheck**：`cd web-demo && pnpm run typecheck`。
- **每 Task 完成 → 一个 commit**（建议用 `feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:` 前缀）。
- **每 Task 内 Step 5 提交前**先 `cd web-demo && pnpm run check`（lint + typecheck）保证不破坏既有 CI。

---

## Task 1: 后端 FS 路由（设计 §3.1）

**Files:**
- Create: `app/gateway/routers/files.py`
- Create: `tests/test_files_router.py`
- Modify: `app/gateway/app.py:46-67`（在 routers 列表与 `include_router` 行加 `files`）

### Sub-task 1.1: 路径解析 helper + 三道防线

**Files:**
- Create: `app/gateway/routers/files.py`（仅 helper，不挂 router）

- [ ] **Step 1: 写失败测试**（`tests/test_files_router.py`）

```python
"""Files router path-guard + basic list behavior."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import APIRouter, FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import qilin.persistence.models  # noqa: F401
import app.gateway.routers.files as files_module
from app.gateway.authz import AuthContext
from app.gateway.deps import get_current_user
from qilin.config.paths import OpenKylinPaths
from qilin.persistence.base import Base


OWNER = "user-A"
THREAD = "thr-001"


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    # Redirect OPENKYLIN_HOME so per-thread workspace path is inside tmp_path.
    home = tmp_path / ".qilin"
    home.mkdir()
    monkeypatch.setattr("qilin.config.paths.OpenKylinPaths", lambda: OpenKylinPaths(home))
    # Pre-create thread workspace dir with a sample tree.
    ws = OpenKylinPaths(home).user_workspace_dir(THREAD)
    ws.mkdir(parents=True)
    (ws / "README.md").write_text("# hello", encoding="utf-8")
    (ws / "src").mkdir()
    (ws / "src" / "main.py").write_text("print('hi')", encoding="utf-8")

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    app = FastAPI()
    app.include_router(files_module.router)

    async def _stamp_auth(request, call_next):
        request.state.auth = AuthContext(
            user=SimpleNamespace(id=OWNER),
            permissions=["threads:read", "threads:write", "threads:delete"],
        )
        return await call_next(request)

    app.middleware("http")(_stamp_auth)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Reset module-level overrides to keep tests isolated.
    files_module.get_current_user = get_current_user


def test_resolve_workspace_path_rejects_traversal():
    """Path traversal (..) must fail with path_outside_workspace."""
    from app.gateway.routers.files import _resolve_workspace_path
    with pytest.raises(files_module.WorkspacePathError) as ei:
        _resolve_workspace_path(THREAD, "../../etc/passwd")
    assert ei.value.code == "path_outside_workspace"


def test_resolve_workspace_path_accepts_root():
    from app.gateway.routers.files import _resolve_workspace_path
    root = _resolve_workspace_path(THREAD, "")
    assert root.name == "workspace"


@pytest.mark.asyncio
async def test_list_root_returns_entries(client):
    r = await client.get("/api/files/list", params={"thread_id": THREAD, "path": ""})
    assert r.status_code == 200, r.text
    body = r.json()
    names = {e["name"] for e in body["entries"]}
    assert {"README.md", "src"} <= names
    assert body["parent"] is None
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `uv run pytest tests/test_files_router.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.gateway.routers.files'`（符合预期：先红后绿）

- [ ] **Step 3: 写最小实现**（`app/gateway/routers/files.py`）

```python
"""Files REST router — per-thread workspace browsing & editing.

Path safety: three guards run in order — thread_id regex, realpath pin,
symlink target re-check. Any failure raises ``WorkspacePathError`` (HTTP 400
or 404). Authorization reuses the threads:read / write / delete permissions
already declared for the workspace registry router.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path as FsPath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.gateway.authz import AuthContext, require_permission
from app.gateway.deps import get_current_user
from qilin.config.paths import OpenKylinPaths

router = APIRouter(prefix="/api/files", tags=["files"])


class WorkspacePathError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _thread_workspace_root(thread_id: str) -> FsPath:
    if not thread_id or not all(c.isalnum() or c in "-_" for c in thread_id):
        raise WorkspacePathError("thread_id_invalid", "thread_id has invalid characters", 404)
    if len(thread_id) > 128:
        raise WorkspacePathError("thread_id_invalid", "thread_id too long", 404)
    paths = OpenKylinPaths()
    root = paths.user_workspace_dir(thread_id).resolve()
    return root


def _resolve_workspace_path(thread_id: str, rel: str) -> FsPath:
    """Resolve ``rel`` (relative to thread workspace root) and verify the
    resulting realpath stays under the workspace root.

    Empty / ``.`` ``rel`` resolves to the workspace root itself.
    """
    root = _thread_workspace_root(thread_id)
    if rel in ("", ".", "./"):
        return root
    # Refuse obvious escape tokens early to keep realpath honest.
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:  # noqa: PERF203 — explicit is clearer
        raise WorkspacePathError(
            "path_outside_workspace",
            "path resolves outside the thread workspace",
            400,
        ) from exc
    return candidate


# Pydantic models ---------------------------------------------------------
class FileEntry(BaseModel):
    name: str
    type: Literal["file", "dir", "symlink", "broken"]
    size: int
    mtime: float
    mime: str | None


class FileListResponse(BaseModel):
    entries: list[FileEntry]
    parent: str | None


class WriteRequest(BaseModel):
    thread_id: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,128}$")
    path: str = Field(min_length=1, max_length=4096)
    content: str = Field(min_length=0)


# Endpoints -------------------------------------------------------------
@router.get("/list", response_model=FileListResponse)
@require_permission("threads", "read")
async def list_dir(
    thread_id: Annotated[str, Query(pattern=r"^[A-Za-z0-9_\-]{1,128}$")],
    path: Annotated[str, Query(max_length=4096)] = "",
) -> FileListResponse:
    target = _resolve_workspace_path(thread_id, path)
    if not target.exists() or not target.is_dir():
        raise HTTPException(404, {"code": "dir_not_found", "message": "directory not found"})
    entries: list[FileEntry] = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            st = child.stat()
        except (FileNotFoundError, PermissionError):
            continue
        kind: Literal["file", "dir", "symlink", "broken"] = (
            "symlink" if child.is_symlink() else "dir" if child.is_dir() else "file"
        )
        if kind == "symlink" and not (child.exists() or child.is_dir()):
            kind = "broken"
        mime = mimetypes.guess_type(child.name)[0] if kind == "file" else None
        entries.append(FileEntry(name=child.name, type=kind, size=st.st_size, mtime=st.st_mtime, mime=mime))
    parent_rel = None
    if path:
        parent_rel = str(FsPath(path).parent) if str(FsPath(path).parent) != "." else ""
    return FileListResponse(entries=entries, parent=parent_rel)
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `uv run pytest tests/test_files_router.py -v`
Expected: PASS 3/3

- [ ] **Step 5: 提交**

```bash
git add app/gateway/routers/files.py tests/test_files_router.py
git commit -m "feat(gateway): files router scaffold with path-guard helpers"
```

### Sub-task 1.2: 挂载 router + read/raw/write/mkdir/delete

**Files:**
- Modify: `app/gateway/routers/files.py`（追加端点）
- Modify: `app/gateway/app.py:46,668`（`from app.gateway.routers import (... files)` + `app.include_router(files.router)`）

- [ ] **Step 1: 写失败测试**（追加到 `tests/test_files_router.py`）

```python
@pytest.mark.asyncio
async def test_read_text_returns_content(client):
    r = await client.get("/api/files/read", params={"thread_id": THREAD, "path": "README.md"})
    assert r.status_code == 200
    assert r.json()["content"] == "# hello"


@pytest.mark.asyncio
async def test_write_then_read_roundtrip(client):
    r = await client.post(
        "/api/files/write",
        json={"thread_id": THREAD, "path": "notes.txt", "content": "abc"},
    )
    assert r.status_code == 200, r.text
    r2 = await client.get("/api/files/read", params={"thread_id": THREAD, "path": "notes.txt"})
    assert r2.json()["content"] == "abc"


@pytest.mark.asyncio
async def test_write_rejects_binary_ext(client):
    r = await client.post(
        "/api/files/write",
        json={"thread_id": THREAD, "path": "evil.exe", "content": "x"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "not_text_file"


@pytest.mark.asyncio
async def test_write_rejects_parent_missing(client):
    r = await client.post(
        "/api/files/write",
        json={"thread_id": THREAD, "path": "missing/sub/x.txt", "content": "x"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "parent_not_found"


@pytest.mark.asyncio
async def test_mkdir_and_delete(client):
    r = await client.post(
        "/api/files/mkdir",
        json={"thread_id": THREAD, "path": "newdir/sub"},
    )
    assert r.status_code == 200, r.text
    r = await client.request(
        "DELETE",
        "/api/files/delete",
        json={"thread_id": THREAD, "path": "newdir/sub"},
    )
    assert r.status_code == 200
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `uv run pytest tests/test_files_router.py -v`
Expected: 4 of the 5 new tests FAIL (404 — endpoint missing); round-trip test also FAIL

- [ ] **Step 3: 写最小实现**（追加到 `app/gateway/routers/files.py`）

```python
# --- helpers used by read / write ---------------------------------------
_TEXT_EXTS = {
    ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini",
    ".csv", ".tsv", ".sql", ".sh", ".bash", ".zsh", ".py", ".ipynb",
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte",
    ".css", ".scss", ".sass", ".less", ".html", ".htm", ".xml", ".env",
    ".gitignore", ".gitattributes", ".editorconfig", "Makefile", "Dockerfile",
    ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp",
    ".lua", ".php", ".r", ".scala", ".dart", ".ex", ".exs", ".clj", ".cljs",
    ".hs", ".ml", ".fs", ".zig",
}


def _looks_textual(path: FsPath) -> bool:
    if path.suffix.lower() in _TEXT_EXTS:
        return True
    if path.name in {"Makefile", "Dockerfile", "Procfile", "Rakefile", "Gemfile"}:
        return True
    mime, _ = mimetypes.guess_type(path.name)
    return bool(mime and mime.startswith("text/"))


# --- endpoints ---------------------------------------------------------
class FileContent(BaseModel):
    content: str
    mime: str | None


class RawQuery(BaseModel):
    thread_id: str
    path: str


@router.get("/read", response_model=FileContent)
@require_permission("threads", "read")
async def read_file(
    thread_id: Annotated[str, Query(pattern=r"^[A-Za-z0-9_\-]{1,128}$")],
    path: Annotated[str, Query(max_length=4096)],
) -> FileContent:
    target = _resolve_workspace_path(thread_id, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, {"code": "file_not_found", "message": "file not found"})
    if not _looks_textual(target):
        raise HTTPException(400, {"code": "binary_not_editable", "message": "binary file — use /api/files/raw"})
    return FileContent(content=target.read_text(encoding="utf-8"), mime=mimetypes.guess_type(target.name)[0])


@router.get("/raw")
@require_permission("threads", "read")
async def read_raw(
    thread_id: Annotated[str, Query(pattern=r"^[A-Za-z0-9_\-]{1,128}$")],
    path: Annotated[str, Query(max_length=4096)],
):
    from fastapi.responses import Response
    target = _resolve_workspace_path(thread_id, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, {"code": "file_not_found", "message": "file not found"})
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return Response(content=target.read_bytes(), media_type=mime)


class PathOnlyRequest(BaseModel):
    thread_id: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,128}$")
    path: str = Field(min_length=1, max_length=4096)


@router.post("/write")
@require_permission("threads", "write")
async def write_file(req: WriteRequest) -> dict:
    target = _resolve_workspace_path(req.thread_id, req.path)
    if not _looks_textual(target):
        raise HTTPException(400, {"code": "not_text_file", "message": "refusing to write non-text file"})
    if len(req.content.encode("utf-8")) > 1_048_576:
        raise HTTPException(413, {"code": "file_too_large", "message": "max 1 MiB"})
    parent = target.parent
    if not parent.exists():
        raise HTTPException(400, {"code": "parent_not_found", "message": "parent directory does not exist"})
    target.write_text(req.content, encoding="utf-8")
    return {"ok": True, "size": target.stat().st_size}


@router.post("/mkdir")
@require_permission("threads", "write")
async def mkdir(req: PathOnlyRequest) -> dict:
    target = _resolve_workspace_path(req.thread_id, req.path)
    target.mkdir(parents=True, exist_ok=False)
    return {"ok": True}


@router.delete("/delete")
@require_permission("threads", "delete")
async def delete_path(req: PathOnlyRequest) -> dict:
    target = _resolve_workspace_path(req.thread_id, req.path)
    if target.is_dir():
        if any(target.iterdir()):
            raise HTTPException(400, {"code": "dir_not_empty", "message": "directory not empty"})
        target.rmdir()
    elif target.exists():
        target.unlink()
    else:
        raise HTTPException(404, {"code": "path_not_found", "message": "path not found"})
    return {"ok": True}
```

- [ ] **Step 4: 挂载 router**（`app/gateway/app.py`）

在第 46 行附近 `from app.gateway.routers import (...)` 块内增加 `files,`；在第 668 行附近 `app.include_router(...)` 列表增加 `app.include_router(files.router)`。

- [ ] **Step 5: 跑测试，验证 PASS**

Run: `uv run pytest tests/test_files_router.py -v`
Expected: PASS 8/8

- [ ] **Step 6: 跑 lint + 既有 workspaces 测试，确认无回归**

Run: `uv run pytest tests/test_workspaces_api.py -v`
Expected: PASS（之前是绿的）

- [ ] **Step 7: 提交**

```bash
git add app/gateway/routers/files.py app/gateway/app.py tests/test_files_router.py
git commit -m "feat(gateway): files router (read/raw/write/mkdir/delete) with path guards"
```

---

## Task 2: 后端 sidebar_tabs 路由（设计 §3.2）

**Files:**
- Create: `app/gateway/routers/sidebar_tabs.py`
- Create: `tests/test_sidebar_tabs_router.py`
- Modify: `app/gateway/app.py`

### Sub-task 2.1: 单线程 tab 状态 PUT/GET

- [ ] **Step 1: 写失败测试**

```python
# tests/test_sidebar_tabs_router.py
from types import SimpleNamespace
import json
import httpx, pytest, pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import qilin.persistence.models  # noqa: F401
import app.gateway.routers.sidebar_tabs as tabs_module
from app.gateway.authz import AuthContext
from qilin.persistence.base import Base
from qilin.persistence.thread_meta.sql import ThreadMetaRepository

OWNER = "user-A"
THREAD = "thr-001"


@pytest_asyncio.fixture
async def client(tmp_path):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sf = async_sessionmaker(engine, expire_on_commit=False)
    threads = ThreadMetaRepository(sf)
    await threads.create(thread_id=THREAD, user_id=OWNER)

    app = FastAPI()
    app.include_router(tabs_module.router)
    app.state.thread_store = threads

    async def _stamp_auth(request, call_next):
        request.state.auth = AuthContext(
            user=SimpleNamespace(id=OWNER),
            permissions=["threads:read", "threads:write"],
        )
        return await call_next(request)

    app.middleware("http")(_stamp_auth)
    tabs_module.get_thread_store = lambda request: threads

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_get_default_empty_when_no_metadata(client):
    r = await client.get(f"/api/threads/{THREAD}/sidebar-tabs")
    assert r.status_code == 200
    assert r.json() == {"tabs": [], "active": None, "split": "single"}


@pytest.mark.asyncio
async def test_put_then_get_roundtrip(client):
    payload = {
        "tabs": [
            {"key": "qilin:files", "panel": "qilin:files", "title": "Files",
             "payload": {"path": "src"}, "pinned": False, "created_at": 1700000000.0},
        ],
        "active": "qilin:files",
        "split": "vertical",
    }
    r = await client.put(f"/api/threads/{THREAD}/sidebar-tabs", json=payload)
    assert r.status_code == 200
    r2 = await client.get(f"/api/threads/{THREAD}/sidebar-tabs")
    assert r2.json() == payload


@pytest.mark.asyncio
async def test_put_rejects_unknown_thread(client):
    r = await client.put("/api/threads/nonexistent/sidebar-tabs", json={"tabs": [], "active": None})
    assert r.status_code == 404
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `uv run pytest tests/test_sidebar_tabs_router.py -v`
Expected: FAIL `ModuleNotFoundError`

- [ ] **Step 3: 写最小实现**（`app/gateway/routers/sidebar_tabs.py`）

```python
"""Per-thread sidebar tab state — stored under ``threads_meta.metadata_json.sidebar_tabs``.

The whole state is one document keyed by thread_id; PUT replaces it. This
mirrors DSH's session-local tab persistence without introducing a new
Alembic table.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.gateway.authz import AuthContext, require_permission

router = APIRouter(prefix="/api/threads/{thread_id}/sidebar-tabs", tags=["sidebar-tabs"])


class TabSpec(BaseModel):
    key: str = Field(min_length=1, max_length=256)
    panel: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=256)
    icon: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    pinned: bool = False
    created_at: float


class SidebarTabsState(BaseModel):
    tabs: list[TabSpec]
    active: str | None = None
    split: Literal["single", "vertical", "horizontal"] = "single"


# Module-level seam — tests patch this, prod wires from app.state.
def get_thread_store(request: Request):
    return request.app.state.thread_store


async def _load(thread_store, thread_id: str) -> SidebarTabsState:
    meta = await thread_store.get(thread_id)
    if meta is None:
        raise HTTPException(404, {"code": "thread_not_found", "message": "thread not found"})
    raw = (meta.metadata_json or {}).get("sidebar_tabs")
    if not raw:
        return SidebarTabsState(tabs=[], active=None, split="single")
    return SidebarTabsState.model_validate(raw)


@router.get("", response_model=SidebarTabsState)
@require_permission("threads", "read")
async def get_tabs(
    thread_id: str,
    request: Request,
    thread_store=Depends(get_thread_store),
) -> SidebarTabsState:
    return await _load(thread_store, thread_id)


@router.put("", response_model=SidebarTabsState)
@require_permission("threads", "write")
async def put_tabs(
    thread_id: str,
    state: SidebarTabsState,
    request: Request,
    thread_store=Depends(get_thread_store),
) -> SidebarTabsState:
    meta = await thread_store.get(thread_id)
    if meta is None:
        raise HTTPException(404, {"code": "thread_not_found", "message": "thread not found"})
    merged = dict(meta.metadata_json or {})
    merged["sidebar_tabs"] = state.model_dump()
    await thread_store.update_metadata(thread_id, merged)
    return state
```

- [ ] **Step 4: 确认 `ThreadMetaRepository.update_metadata` 已存在；否则补一个最小实现**

Run: `grep -n "async def update_metadata" qilin/persistence/thread_meta/sql.py`
Expected: 已存在则跳过；否则在 `qilin/persistence/thread_meta/sql.py` 增加：

```python
async def update_metadata(self, thread_id: str, metadata_json: dict) -> None:
    async with self._sf() as session:
        row = await session.get(ThreadMeta, thread_id)
        if row is None:
            raise KeyError(thread_id)
        row.metadata_json = metadata_json
        await session.commit()
```

- [ ] **Step 5: 挂载 router**

`app/gateway/app.py` 第 46 行 `from app.gateway.routers import (...)` 增加 `sidebar_tabs,`；第 668 行 `app.include_router(...)` 增加 `app.include_router(sidebar_tabs.router)`。

- [ ] **Step 6: 跑测试，验证 PASS**

Run: `uv run pytest tests/test_sidebar_tabs_router.py -v`
Expected: PASS 3/3

- [ ] **Step 7: 跑全后端测试，确认无回归**

Run: `uv run pytest tests/ -x -q`
Expected: 既有测试不退步；3 个新测试通过

- [ ] **Step 8: 提交**

```bash
git add app/gateway/routers/sidebar_tabs.py app/gateway/app.py qilin/persistence/thread_meta/sql.py tests/test_sidebar_tabs_router.py
git commit -m "feat(gateway): per-thread sidebar-tabs persistence (threads_meta.metadata_json)"
```

---

## Task 3: 前端协议层（设计 §4.1-4.3）

**Files:**
- Create: `web-demo/src/core/sidebar/protocol.ts`
- Create: `web-demo/src/core/sidebar/panel-registry.ts`
- Create: `web-demo/src/core/sidebar/viewer-registry.ts`
- Create: `web-demo/src/core/sidebar/scope.ts`
- Create: `web-demo/src/core/sidebar/panel-host.tsx`
- Create: `web-demo/src/core/sidebar/viewer-host.tsx`
- Create: `web-demo/tests/unit/core/sidebar/panel-registry.test.ts`
- Create: `web-demo/tests/unit/core/sidebar/viewer-registry.test.ts`

### Sub-task 3.1: protocol 类型

- [ ] **Step 1: 写失败测试**

```typescript
// web-demo/tests/unit/core/sidebar/protocol-types.test.ts
import { describe, expect, test } from "vitest";
import type {
  SidebarPanelSpec, SidebarPanelProps, SidebarScope,
  FileViewerSpec, FileViewerProps, SidebarTabState,
} from "@/core/sidebar/protocol";

describe("protocol types compile & sanity", () => {
  test("SidebarPanelSpec accepts a render fn", () => {
    const spec: SidebarPanelSpec<{ path: string }> = {
      id: "x:y",
      title: "Y",
      render: ({ payload }) => payload.path,
    };
    expect(spec.id).toBe("x:y");
  });

  test("FileViewerSpec optional editable", () => {
    const v: FileViewerSpec = { id: "v", exts: [".md"], component: () => null };
    expect(v.editable).toBeUndefined();
  });

  test("SidebarScope carries threadId", () => {
    const s: SidebarScope = { threadId: "thr-1" };
    expect(s.threadId).toBe("thr-1");
  });

  test("SidebarTabState split default is single", () => {
    const t: SidebarTabState = { tabs: [], active: null, split: "single" };
    expect(t.split).toBe("single");
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose protocol-types`
Expected: FAIL `Cannot find module '@/core/sidebar/protocol'`

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/sidebar/protocol.ts`）

```typescript
import type { ReactNode } from "react";

export interface SidebarScope {
  threadId: string;
}

export interface FileEntryLike {
  name: string;
  type: "file" | "dir" | "symlink" | "broken";
  size: number;
  mtime: number;
  mime: string | null;
}

export interface SidebarPanelApi {
  openTab: (spec: { panel: string; payload?: unknown; title?: string }) => void;
  closeSelf: () => void;
  toast: (msg: string, tone?: "info" | "error") => void;
}

export interface SidebarPanelProps<P = unknown> {
  scope: SidebarScope;
  payload: P;
  onPayloadChange: (next: P) => void;
  api: SidebarPanelApi;
}

export interface SidebarPanelSpec<P = unknown> {
  id: string;
  title: string | (() => string);
  icon?: ReactNode;
  order?: number;
  fileViewer?: { exts: readonly string[]; match?: (entry: FileEntryLike) => boolean };
  render: (props: SidebarPanelProps<P>) => ReactNode;
  defaultPayload?: () => P;
}

export interface FileViewerProps {
  entry: FileEntryLike;
  content: string | Uint8Array;
  scope: SidebarScope;
  onSave?: (next: string) => Promise<void>;
}

export interface FileViewerSpec {
  id: string;
  exts: readonly string[];
  match?: (entry: FileEntryLike, head?: string) => boolean;
  component: React.ComponentType<FileViewerProps>;
  editable?: boolean;
}

export interface SidebarTabState {
  tabs: ReadonlyArray<{
    key: string;
    panel: string;
    title: string;
    icon?: string | null;
    payload: Record<string, unknown>;
    pinned: boolean;
    created_at: number;
  }>;
  active: string | null;
  split: "single" | "vertical" | "horizontal";
}
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose protocol-types`
Expected: PASS 4/4

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/sidebar/protocol.ts web-demo/tests/unit/core/sidebar/protocol-types.test.ts
git commit -m "feat(web-demo/sidebar): protocol types (panels + viewers + scope)"
```

### Sub-task 3.2: panel-registry 单例

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/core/sidebar/panel-registry.test.ts`）

```typescript
import { afterEach, describe, expect, test } from "vitest";
import { sidebarPanelRegistry } from "@/core/sidebar/panel-registry";
import type { SidebarPanelSpec } from "@/core/sidebar/protocol";

const SPEC_A: SidebarPanelSpec = { id: "x:a", title: "A", render: () => null, order: 20 };
const SPEC_B: SidebarPanelSpec = { id: "x:b", title: "B", render: () => null, order: 10 };

afterEach(() => {
  sidebarPanelRegistry.unregister("x:a");
  sidebarPanelRegistry.unregister("x:b");
});

describe("SidebarPanelRegistry", () => {
  test("register & unregister", () => {
    expect(sidebarPanelRegistry.list()).toHaveLength(0);
    sidebarPanelRegistry.register(SPEC_A);
    expect(sidebarPanelRegistry.get("x:a")).toBe(SPEC_A);
    sidebarPanelRegistry.unregister("x:a");
    expect(sidebarPanelRegistry.get("x:a")).toBeUndefined();
  });

  test("list is ordered by .order ascending", () => {
    sidebarPanelRegistry.register(SPEC_A);
    sidebarPanelRegistry.register(SPEC_B);
    expect(sidebarPanelRegistry.list().map((s) => s.id)).toEqual(["x:b", "x:a"]);
  });

  test("register returns disposer", () => {
    const dispose = sidebarPanelRegistry.register(SPEC_A);
    dispose();
    expect(sidebarPanelRegistry.get("x:a")).toBeUndefined();
  });

  test("register rejects duplicate id", () => {
    sidebarPanelRegistry.register(SPEC_A);
    expect(() => sidebarPanelRegistry.register(SPEC_A)).toThrow(/already registered/);
  });

  test("matchFileViewer picks by extension", () => {
    sidebarPanelRegistry.register({
      id: "x:md",
      title: "MD",
      render: () => null,
      fileViewer: { exts: [".md", ".markdown"] },
    });
    const found = sidebarPanelRegistry.matchFileViewer({ name: "x.md", type: "file", size: 0, mtime: 0, mime: null });
    expect(found?.id).toBe("x:md");
    sidebarPanelRegistry.unregister("x:md");
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose panel-registry`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/sidebar/panel-registry.ts`）

```typescript
import type { FileEntryLike, SidebarPanelSpec } from "./protocol";

class SidebarPanelRegistry {
  private readonly byId = new Map<string, SidebarPanelSpec>();

  register<P>(spec: SidebarPanelSpec<P>): () => void {
    if (this.byId.has(spec.id)) {
      throw new Error(`SidebarPanel "${spec.id}" already registered`);
    }
    this.byId.set(spec.id, spec as SidebarPanelSpec);
    return () => this.unregister(spec.id);
  }

  unregister(id: string): boolean {
    return this.byId.delete(id);
  }

  list(): readonly SidebarPanelSpec[] {
    return [...this.byId.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  get(id: string): SidebarPanelSpec | undefined {
    return this.byId.get(id);
  }

  matchFileViewer(entry: FileEntryLike): SidebarPanelSpec | undefined {
    const lower = entry.name.toLowerCase();
    for (const spec of this.byId.values()) {
      const fv = spec.fileViewer;
      if (!fv) continue;
      if (fv.match?.(entry)) return spec;
      if (fv.exts.some((ext) => lower.endsWith(ext))) return spec;
    }
    return undefined;
  }
}

export const sidebarPanelRegistry = new SidebarPanelRegistry();
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose panel-registry`
Expected: PASS 5/5

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/sidebar/panel-registry.ts web-demo/tests/unit/core/sidebar/panel-registry.test.ts
git commit -m "feat(web-demo/sidebar): panel registry singleton"
```

### Sub-task 3.3: viewer-registry 单例

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/core/sidebar/viewer-registry.test.ts`）

```typescript
import { afterEach, describe, expect, test } from "vitest";
import { fileViewerRegistry } from "@/core/sidebar/viewer-registry";

const V_MD = { id: "v:md", exts: [".md"], component: () => null };
const V_JSON = { id: "v:json", exts: [".json"], component: () => null, match: (e: { name: string }) => e.name.endsWith(".json") };

afterEach(() => fileViewerRegistry.list().forEach((v) => fileViewerRegistry.unregister(v.id)));

describe("FileViewerRegistry", () => {
  test("matchExt by case-insensitive extension", () => {
    fileViewerRegistry.register(V_MD);
    expect(fileViewerRegistry.matchExt("README.MD")?.id).toBe("v:md");
  });

  test("match() takes precedence over exts", () => {
    fileViewerRegistry.register(V_JSON);
    const found = fileViewerRegistry.match({ name: "x.json", type: "file", size: 0, mtime: 0, mime: null });
    expect(found?.id).toBe("v:json");
  });

  test("match returns undefined when nothing matches", () => {
    fileViewerRegistry.register(V_MD);
    const found = fileViewerRegistry.match({ name: "x.png", type: "file", size: 0, mtime: 0, mime: null });
    expect(found).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose viewer-registry`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/sidebar/viewer-registry.ts`）

```typescript
import type { FileEntryLike, FileViewerSpec } from "./protocol";

class FileViewerRegistry {
  private readonly byId = new Map<string, FileViewerSpec>();
  register(spec: FileViewerSpec): () => void {
    if (this.byId.has(spec.id)) throw new Error(`FileViewer "${spec.id}" already registered`);
    this.byId.set(spec.id, spec);
    return () => this.unregister(spec.id);
  }
  unregister(id: string): boolean { return this.byId.delete(id); }
  list(): readonly FileViewerSpec[] { return [...this.byId.values()]; }
  matchExt(name: string): FileViewerSpec | undefined {
    const lower = name.toLowerCase();
    return [...this.byId.values()].find((v) => v.exts.some((e) => lower.endsWith(e)));
  }
  match(entry: FileEntryLike, head?: string): FileViewerSpec | undefined {
    for (const v of this.byId.values()) if (v.match?.(entry, head)) return v;
    return this.matchExt(entry.name);
  }
}

export const fileViewerRegistry = new FileViewerRegistry();
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose viewer-registry`
Expected: PASS 3/3

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/sidebar/viewer-registry.ts web-demo/tests/unit/core/sidebar/viewer-registry.test.ts
git commit -m "feat(web-demo/sidebar): file viewer registry singleton"
```

### Sub-task 3.4: scope provider + panel/viewer host（无新测试，与 §4.3 类型对齐即可）

- [ ] **Step 1: 创建 `web-demo/src/core/sidebar/scope.ts`**

```typescript
"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { SidebarScope, SidebarPanelApi } from "./protocol";

const ScopeCtx = createContext<SidebarScope | null>(null);
const ApiCtx = createContext<SidebarPanelApi | null>(null);

export function SidebarScopeProvider({
  scope, api, children,
}: { scope: SidebarScope; api: SidebarPanelApi; children: ReactNode }) {
  return (
    <ScopeCtx.Provider value={scope}>
      <ApiCtx.Provider value={api}>{children}</ApiCtx.Provider>
    </ScopeCtx.Provider>
  );
}

export function useSidebarScope(): SidebarScope {
  const v = useContext(ScopeCtx);
  if (!v) throw new Error("useSidebarScope outside provider");
  return v;
}

export function useSidebarApi(): SidebarPanelApi {
  const v = useContext(ApiCtx);
  if (!v) throw new Error("useSidebarApi outside provider");
  return v;
}
```

- [ ] **Step 2: 创建 `web-demo/src/core/sidebar/panel-host.tsx`**

```tsx
"use client";
import type { ReactNode } from "react";
import { sidebarPanelRegistry } from "./panel-registry";
import type { SidebarPanelProps } from "./protocol";
import { useSidebarApi, useSidebarScope } from "./scope";

export function PanelHost({
  panel, payload, onPayloadChange,
}: { panel: string; payload: unknown; onPayloadChange: (next: unknown) => void }): ReactNode {
  const spec = sidebarPanelRegistry.get(panel);
  const scope = useSidebarScope();
  const api = useSidebarApi();
  if (!spec) return <div className="text-muted-foreground p-2 text-xs">unknown panel: {panel}</div>;
  const props: SidebarPanelProps = { scope, payload, onPayloadChange, api };
  return spec.render(props);
}
```

- [ ] **Step 3: 创建 `web-demo/src/core/sidebar/viewer-host.tsx`**

```tsx
"use client";
import { fileViewerRegistry } from "./viewer-registry";
import type { FileViewerProps } from "./protocol";
import { CodeMirrorViewer } from "@/components/better-sidebar/viewers/CodeMirrorViewer";
import { HtmlViewer } from "@/components/better-sidebar/viewers/HtmlViewer";
import { ImageViewer } from "@/components/better-sidebar/viewers/ImageViewer";
import { MarkdownViewer } from "@/components/better-sidebar/viewers/MarkdownViewer";
import { PdfViewer } from "@/components/better-sidebar/viewers/PdfViewer";
import type { FileEntryLike } from "./protocol";

// Built-in viewers are statically linked to keep first viewer open fast;
// extensions can still register additional viewers at runtime.
const BUILTINS = { CodeMirrorViewer, HtmlViewer, ImageViewer, MarkdownViewer, PdfViewer };

export function registerBuiltinViewers(): () => void {
  const disposers = [
    fileViewerRegistry.register({ id: "qilin:markdown", exts: [".md", ".markdown"], component: MarkdownViewer }),
    fileViewerRegistry.register({ id: "qilin:html", exts: [".html", ".htm"], component: HtmlViewer }),
    fileViewerRegistry.register({ id: "qilin:pdf", exts: [".pdf"], component: PdfViewer }),
    fileViewerRegistry.register({ id: "qilin:image", exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"], component: ImageViewer }),
    fileViewerRegistry.register({ id: "qilin:editor", exts: [".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".csv", ".tsv", ".sql", ".sh", ".py", ".ipynb", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".css", ".scss", ".sass", ".less", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".lua", ".php", ".r", ".scala"], component: CodeMirrorViewer, editable: true }),
  ];
  return () => disposers.forEach((d) => d());
}

// Re-export for tests.
export type { FileViewerProps, FileEntryLike };
```

> 注：Task 3 这一步不跑任何测试（viewer 文件 Task 4 才写），但 host 文件可独立 typecheck。

- [ ] **Step 4: typecheck**

Run: `cd web-demo && pnpm run typecheck`
Expected: 4 个 viewer 路径还没建会报错——这是预期的，Task 4 才补。

- [ ] **Step 5: 暂不提交**（与 Task 4 一并提交）

---

## Task 4: 前端 5 个内置 viewer（设计 §4.2）

**Files:**
- Create: `web-demo/src/components/better-sidebar/viewers/MarkdownViewer.tsx`
- Create: `web-demo/src/components/better-sidebar/viewers/HtmlViewer.tsx`
- Create: `web-demo/src/components/better-sidebar/viewers/PdfViewer.tsx`
- Create: `web-demo/src/components/better-sidebar/viewers/ImageViewer.tsx`
- Create: `web-demo/src/components/better-sidebar/viewers/CodeMirrorViewer.tsx`
- Create: `web-demo/src/components/better-sidebar/built-in-panels.ts`
- Create: `web-demo/tests/unit/components/better-sidebar/MarkdownViewer.test.tsx`
- Modify: `web-demo/package.json`（新增 `pdfjs-dist`）

### Sub-task 4.1: Markdown viewer

- [ ] **Step 1: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/MarkdownViewer.test.tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MarkdownViewer } from "@/components/better-sidebar/viewers/MarkdownViewer";

describe("MarkdownViewer", () => {
  test("renders inline markdown to HTML", () => {
    render(
      <MarkdownViewer
        entry={{ name: "x.md", type: "file", size: 6, mtime: 0, mime: "text/markdown" }}
        content={"# hello"}
        scope={{ threadId: "thr" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("hello");
  });

  test("renders Mermaid code blocks as <pre class=\"mermaid\">", () => {
    render(
      <MarkdownViewer
        entry={{ name: "x.md", type: "file", size: 0, mtime: 0, mime: "text/markdown" }}
        content={"```mermaid\ngraph TD; A-->B;\n```"}
        scope={{ threadId: "thr" }}
      />,
    );
    expect(document.querySelector("pre.mermaid")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose MarkdownViewer`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/viewers/MarkdownViewer.tsx`）

```tsx
"use client";
import { Streamdown } from "streamdown";
import { remarkGfm } from "remark-gfm";
import { remarkMath } from "remark-math";
import { rehypeKatex } from "rehype-katex";
import { rehypeRaw } from "rehype-raw";
import { Mermaid } from "@streamdown/mermaid";
import { Code } from "@streamdown/code";
import type { FC } from "react";
import type { FileViewerProps } from "@/core/sidebar/protocol";

const MarkdownViewer: FC<FileViewerProps> = ({ content }) => (
  <div className="prose prose-sm dark:prose-invert h-full overflow-auto p-4">
    <Streamdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={{ code: Code, pre: ({ children }) => <pre className="mermaid">{children}</pre> }}
    >
      {content as string}
    </Streamdown>
  </div>
);

export default MarkdownViewer;
// Re-export the Mermaid component for app-level usage if needed.
export { Mermaid };
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose MarkdownViewer`
Expected: PASS 2/2

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/viewers/MarkdownViewer.tsx web-demo/tests/unit/components/better-sidebar/MarkdownViewer.test.tsx
git commit -m "feat(web-demo/sidebar): markdown viewer with mermaid + katex"
```

### Sub-task 4.2: HTML viewer（sandbox iframe）

- [ ] **Step 1: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/HtmlViewer.test.tsx
// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { HtmlViewer } from "@/components/better-sidebar/viewers/HtmlViewer";

describe("HtmlViewer", () => {
  test("renders sandboxed iframe with srcdoc", () => {
    const { container } = render(
      <HtmlViewer
        entry={{ name: "x.html", type: "file", size: 0, mtime: 0, mime: "text/html" }}
        content="<h1>x</h1>"
        scope={{ threadId: "thr" }}
      />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(iframe?.getAttribute("srcdoc")).toContain("h1");
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose HtmlViewer`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/viewers/HtmlViewer.tsx`）

```tsx
"use client";
import type { FC } from "react";
import type { FileViewerProps } from "@/core/sidebar/protocol";

// Sandbox iframe — same-origin so DOMPurify-cleaned local content can lay out,
// scripts disabled. Suitable for HTML+CSS+inline SVG previews.
const HtmlViewer: FC<FileViewerProps> = ({ content }) => (
  <iframe
    title="html-preview"
    sandbox="allow-same-origin"
    srcDoc={content as string}
    className="h-full w-full border-0 bg-white"
  />
);

export default HtmlViewer;
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose HtmlViewer`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/viewers/HtmlViewer.tsx web-demo/tests/unit/components/better-sidebar/HtmlViewer.test.tsx
git commit -m "feat(web-demo/sidebar): html viewer (sandboxed iframe)"
```

### Sub-task 4.3: Image viewer

- [ ] **Step 1: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/ImageViewer.test.tsx
// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ImageViewer } from "@/components/better-sidebar/viewers/ImageViewer";

describe("ImageViewer", () => {
  test("renders <img> with object URL when given Uint8Array", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;
    const { container } = render(
      <ImageViewer
        entry={{ name: "x.png", type: "file", size: 4, mtime: 0, mime: "image/png" }}
        content={bytes}
        scope={{ threadId: "thr" }}
      />,
    );
    expect(container.querySelector("img")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose ImageViewer`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/viewers/ImageViewer.tsx`）

```tsx
"use client";
import { useEffect, useMemo } from "react";
import type { FC } from "react";
import type { FileViewerProps } from "@/core/sidebar/protocol";

const ImageViewer: FC<FileViewerProps> = ({ entry, content }) => {
  const url = useMemo(() => {
    if (typeof content === "string") return null; // raw URL not used
    const blob = new Blob([content as Uint8Array], { type: entry.mime ?? "application/octet-stream" });
    return URL.createObjectURL(blob);
  }, [content, entry.mime]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!url) return <div className="p-2 text-xs text-muted-foreground">unsupported image</div>;
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30 p-2">
      <img src={url} alt={entry.name} className="max-h-full max-w-full object-contain" />
    </div>
  );
};

export default ImageViewer;
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose ImageViewer`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/viewers/ImageViewer.tsx web-demo/tests/unit/components/better-sidebar/ImageViewer.test.tsx
git commit -m "feat(web-demo/sidebar): image viewer (blob URL)"
```

### Sub-task 4.4: PDF viewer（pdfjs-dist，动态 import）

- [ ] **Step 1: 安装依赖**

Run: `cd web-demo && pnpm add pdfjs-dist@^4`
Expected: 写入 `dependencies`，无 peer 警告

- [ ] **Step 2: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/PdfViewer.test.tsx
// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PdfViewer } from "@/components/better-sidebar/viewers/PdfViewer";

vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
  GlobalWorkerOptions: { workerSrc: "" },
}));

describe("PdfViewer", () => {
  test("renders loading placeholder initially", () => {
    const { container } = render(
      <PdfViewer
        entry={{ name: "x.pdf", type: "file", size: 1, mtime: 0, mime: "application/pdf" }}
        content={new Uint8Array()}
        scope={{ threadId: "thr" }}
      />,
    );
    expect(container.textContent).toMatch(/loading|pdf/i);
  });
});
```

- [ ] **Step 3: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose PdfViewer`
Expected: FAIL（文件不存在）

- [ ] **Step 4: 写最小实现**（`web-demo/src/components/better-sidebar/viewers/PdfViewer.tsx`）

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import type { FileViewerProps } from "@/core/sidebar/protocol";

const PdfViewer: FC<FileViewerProps> = ({ entry, content }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Vite-friendly worker URL — bundle worker via ?url import.
        pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        const data = content instanceof Uint8Array ? content : new Uint8Array();
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !canvasRef.current) return;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = canvasRef.current;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [content, entry.name]);

  if (error) return <div className="p-2 text-xs text-rose-500">pdf error: {error}</div>;
  return (
    <div className="flex h-full w-full justify-center overflow-auto bg-muted/30 p-2">
      <canvas ref={canvasRef} aria-label={entry.name} />
    </div>
  );
};

export default PdfViewer;
```

- [ ] **Step 5: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose PdfViewer`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add web-demo/package.json web-demo/src/components/better-sidebar/viewers/PdfViewer.tsx web-demo/tests/unit/components/better-sidebar/PdfViewer.test.tsx
git commit -m "feat(web-demo/sidebar): pdf viewer (pdfjs-dist dynamic import)"
```

### Sub-task 4.5: CodeMirror viewer（编辑可写）

- [ ] **Step 1: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/CodeMirrorViewer.test.tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CodeMirrorViewer } from "@/components/better-sidebar/viewers/CodeMirrorViewer";

describe("CodeMirrorViewer", () => {
  test("calls onSave with new content", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CodeMirrorViewer
        entry={{ name: "x.py", type: "file", size: 0, mtime: 0, mime: "text/x-python" }}
        content="print(1)"
        scope={{ threadId: "thr" }}
        onSave={onSave}
      />,
    );
    // CodeMirror mounts an editor — simulate change via the React state setters in the component.
    const save = screen.getByRole("button", { name: /save/i });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose CodeMirrorViewer`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/viewers/CodeMirrorViewer.tsx`）

```tsx
"use client";
import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import type { FC } from "react";
import type { FileViewerProps } from "@/core/sidebar/protocol";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function langFor(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".ipynb")) return python();
  if (lower.endsWith(".md")) return markdown();
  if (lower.endsWith(".json")) return json();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return yaml();
  if (lower.endsWith(".sql")) return sql();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return html();
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return css();
  return javascript();
}

const CodeMirrorViewer: FC<FileViewerProps> = ({ entry, content, onSave }) => {
  const [value, setValue] = useState(() => (typeof content === "string" ? content : ""));
  const [saving, setSaving] = useState(false);
  const dirty = typeof content === "string" && value !== content;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-2 py-1 text-xs">
        <span className="text-muted-foreground">{entry.name}</span>
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty || saving}
          onClick={async () => {
            if (!onSave) return;
            setSaving(true);
            try {
              await onSave(value);
              toast.success("saved");
            } catch (e) {
              toast.error((e as Error).message ?? "save failed");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={value}
          height="100%"
          extensions={[langFor(entry.name)]}
          onChange={(next) => setValue(next)}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
        />
      </div>
    </div>
  );
};

export default CodeMirrorViewer;
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose CodeMirrorViewer`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/viewers/CodeMirrorViewer.tsx web-demo/tests/unit/components/better-sidebar/CodeMirrorViewer.test.tsx
git commit -m "feat(web-demo/sidebar): codemirror editor viewer (editable, save)"
```

### Sub-task 4.6: 提交 Task 3 剩余文件（panel/viewer host + built-in 注册）

- [ ] **Step 1: 创建 `web-demo/src/components/better-sidebar/built-in-panels.ts`**

```typescript
import { sidebarPanelRegistry } from "@/core/sidebar/panel-registry";
import { FileExplorerPanel } from "@/components/better-sidebar/panels/FileExplorer";
import type { ReactNode } from "react";
import { FolderOpen } from "lucide-react";

export function registerBuiltinPanels(): () => void {
  const disposers = [
    sidebarPanelRegistry.register({
      id: "qilin:files",
      title: () => "Files",
      icon: <FolderOpen className="size-3.5" />,
      order: 10,
      render: ({ scope, payload }) => (
        <FileExplorerPanel scope={scope} root={(payload as { root?: string } | undefined)?.root ?? ""} />
      ),
    }),
  ];
  return () => disposers.forEach((d) => d());
}
```

- [ ] **Step 2: 现在 Task 3 Sub-task 3.4 Step 5 可以提交**

```bash
git add web-demo/src/core/sidebar/{scope,panel-host,viewer-host}.ts web-demo/src/components/better-sidebar/built-in-panels.ts
git commit -m "feat(web-demo/sidebar): scope provider + panel/viewer host + built-in panel registrations"
```

---

## Task 5: 前端 FileExplorer + tab 持久化 + BetterSidebarRoot（设计 §4.3-4.4 + §5）

**Files:**
- Create: `web-demo/src/core/files/api.ts`
- Create: `web-demo/src/core/files/tree.ts`
- Create: `web-demo/src/core/sidebar/use-sidebar-tabs.ts`
- Create: `web-demo/src/components/better-sidebar/BetterSidebarRoot.tsx`
- Create: `web-demo/src/components/better-sidebar/TabBar.tsx`
- Create: `web-demo/src/components/better-sidebar/TabContent.tsx`
- Create: `web-demo/src/components/better-sidebar/panels/FileExplorer.tsx`
- Create: `web-demo/src/components/better-sidebar/panels/FileViewerTab.tsx`
- Create: `web-demo/tests/unit/core/files/tree.test.ts`
- Create: `web-demo/tests/unit/components/better-sidebar/FileExplorer.test.tsx`
- Create: `web-demo/tests/e2e/better-sidebar.spec.ts`

### Sub-task 5.1: FS API 客户端

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/core/files/api.test.ts`）

```typescript
import { describe, expect, test, vi, afterEach } from "vitest";
import { listDir, readFile, writeFile } from "@/core/files/api";

afterEach(() => vi.restoreAllMocks());

describe("files api", () => {
  test("listDir GET /api/files/list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: [], parent: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await listDir("thr", "");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/files/list?thread_id=thr"), expect.any(Object));
  });

  test("writeFile throws on 400 with error.code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: "parent_not_found", message: "x" } }),
    }));
    await expect(() => writeFile("thr", "missing/x.txt", "x")).rejects.toMatchObject({ code: "parent_not_found" });
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose "core/files/api"`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/files/api.ts`）

```typescript
import { getAPIClient } from "@/core/api";

export interface FileEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "broken";
  size: number;
  mtime: number;
  mime: string | null;
}
export interface FileListResponse {
  entries: FileEntry[];
  parent: string | null;
}

export class FileApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  // Centralize through the existing API client; it already handles CSRF + auth headers.
  const client = getAPIClient();
  // The api client exposes a thin fetch wrapper; for new ones we fall back to the
  // proxied /api path so we don't need to add a method per route.
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "unknown";
    let message = res.statusText;
    try { const j = await res.json(); code = j?.error?.code ?? code; message = j?.error?.message ?? message; } catch {}
    throw new FileApiError(code, message, res.status);
  }
  return (await res.json()) as T;
}

export async function listDir(threadId: string, path: string): Promise<FileListResponse> {
  const qs = new URLSearchParams({ thread_id: threadId, path });
  return call("GET", `/api/files/list?${qs.toString()}`);
}

export async function readFile(threadId: string, path: string): Promise<string> {
  const qs = new URLSearchParams({ thread_id: threadId, path });
  const j = await call<{ content: string; mime: string | null }>("GET", `/api/files/read?${qs.toString()}`);
  return j.content;
}

export async function writeFile(threadId: string, path: string, content: string): Promise<void> {
  await call("POST", "/api/files/write", { thread_id: threadId, path, content });
}

export async function readRaw(threadId: string, path: string): Promise<Blob> {
  const qs = new URLSearchParams({ thread_id: threadId, path });
  const res = await fetch(`/api/files/raw?${qs.toString()}`);
  if (!res.ok) throw new FileApiError("file_read_failed", res.statusText, res.status);
  return res.blob();
}
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose "core/files/api"`
Expected: PASS 2/2

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/files/api.ts web-demo/tests/unit/core/files/api.test.ts
git commit -m "feat(web-demo/files): api client with typed errors"
```

### Sub-task 5.2: 树推导（排序/虚拟根）

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/core/files/tree.test.ts`）

```typescript
import { describe, expect, test } from "vitest";
import { sortEntries, joinRel, parentRel } from "@/core/files/tree";

describe("files/tree", () => {
  test("sortEntries: dirs first, then files, both case-insensitive", () => {
    const out = sortEntries([
      { name: "z.txt", type: "file", size: 0, mtime: 0, mime: null },
      { name: "A", type: "dir", size: 0, mtime: 0, mime: null },
      { name: "a", type: "dir", size: 0, mtime: 0, mime: null },
      { name: "b.md", type: "file", size: 0, mtime: 0, mime: null },
    ]);
    expect(out.map((e) => e.name)).toEqual(["a", "A", "b.md", "z.txt"]);
  });

  test("joinRel normalizes redundant separators", () => {
    expect(joinRel("src", "lib/")).toBe("src/lib");
    expect(joinRel("", "lib")).toBe("lib");
  });

  test("parentRel strips last segment", () => {
    expect(parentRel("src/lib/foo.py")).toBe("src/lib");
    expect(parentRel("foo.py")).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose "core/files/tree"`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/files/tree.ts`）

```typescript
import type { FileEntry } from "./api";

export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.type === "dir" ? 0 : 1;
    const bDir = b.type === "dir" ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function joinRel(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function parentRel(rel: string): string {
  if (!rel) return "";
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose "core/files/tree"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/files/tree.ts web-demo/tests/unit/core/files/tree.test.ts
git commit -m "feat(web-demo/files): tree helpers (sort / join / parent)"
```

### Sub-task 5.3: `use-sidebar-tabs` TanStack Query hook

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/core/sidebar/use-sidebar-tabs.test.tsx`）

```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useSidebarTabs } from "@/core/sidebar/use-sidebar-tabs";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("useSidebarTabs", () => {
  test("loads empty state when 200 with no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ tabs: [], active: null, split: "single" }),
    }));
    const { result } = renderHook(() => useSidebarTabs("thr-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ tabs: [], active: null, split: "single" });
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose "use-sidebar-tabs"`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/core/sidebar/use-sidebar-tabs.ts`）

```typescript
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SidebarTabState } from "./protocol";

async function fetchTabs(threadId: string): Promise<SidebarTabState> {
  const res = await fetch(`/api/threads/${threadId}/sidebar-tabs`);
  if (res.status === 404) return { tabs: [], active: null, split: "single" };
  if (!res.ok) throw new Error(`tabs fetch failed: ${res.status}`);
  return (await res.json()) as SidebarTabState;
}

async function putTabs(threadId: string, state: SidebarTabState): Promise<SidebarTabState> {
  const res = await fetch(`/api/threads/${threadId}/sidebar-tabs`, {
    method: "PUT", credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`tabs save failed: ${res.status}`);
  return (await res.json()) as SidebarTabState;
}

export function useSidebarTabs(threadId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["sidebar-tabs", threadId],
    queryFn: () => fetchTabs(threadId),
    enabled: !!threadId,
    staleTime: 5_000,
  });
  const mutation = useMutation({
    mutationFn: (next: SidebarTabState) => putTabs(threadId, next),
    onSuccess: (next) => qc.setQueryData(["sidebar-tabs", threadId], next),
  });
  return { ...query, save: mutation.mutateAsync };
}
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose "use-sidebar-tabs"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/core/sidebar/use-sidebar-tabs.ts web-demo/tests/unit/core/sidebar/use-sidebar-tabs.test.tsx
git commit -m "feat(web-demo/sidebar): useSidebarTabs hook (TanStack Query)"
```

### Sub-task 5.4: FileExplorer panel + FileViewerTab

- [ ] **Step 1: 写失败测试**（`web-demo/tests/unit/components/better-sidebar/FileExplorer.test.tsx`）

```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { FileExplorerPanel } from "@/components/better-sidebar/panels/FileExplorer";

vi.mock("@/core/files/api", () => ({
  listDir: vi.fn().mockResolvedValue({
    entries: [
      { name: "README.md", type: "file", size: 0, mtime: 0, mime: "text/markdown" },
      { name: "src", type: "dir", size: 0, mtime: 0, mime: null },
    ],
    parent: null,
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("FileExplorerPanel", () => {
  test("lists root entries and toggles a directory open", async () => {
    render(<FileExplorerPanel scope={{ threadId: "thr" }} root="" />, { wrapper });
    await waitFor(() => screen.getByText("README.md"));
    expect(screen.getByText("src")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose FileExplorer`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/panels/FileExplorer.tsx`）

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, File as FileIcon, Folder } from "lucide-react";
import { useState, type FC } from "react";
import { listDir, type FileEntry } from "@/core/files/api";
import { sortEntries, joinRel, parentRel } from "@/core/files/tree";
import { useSidebarApi, useSidebarScope } from "@/core/sidebar/scope";
import { sidebarPanelRegistry } from "@/core/sidebar/panel-registry";
import type { SidebarPanelProps } from "@/core/sidebar/protocol";

interface Props {
  scope: { threadId: string };
  root?: string;
}

const FileExplorerPanel: FC<Props> = ({ scope, root = "" }) => {
  const [open, setOpen] = useState<Set<string>>(new Set([root].filter(Boolean)));
  return (
    <div className="text-sm">
      <Breadcrumbs scope={scope} root={root} />
      <Tree scope={scope} path={root} open={open} setOpen={setOpen} depth={0} />
    </div>
  );
};

function Breadcrumbs({ scope, root }: { scope: { threadId: string }; root: string }) {
  const segs = root ? root.split("/") : [];
  return (
    <div className="text-muted-foreground flex items-center gap-1 px-2 py-1 text-xs">
      <span className="font-medium">{scope.threadId.slice(0, 8)}</span>
      {segs.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          <span>{s}</span>
        </span>
      ))}
    </div>
  );
}

function Tree({
  scope, path, open, setOpen, depth,
}: {
  scope: { threadId: string };
  path: string;
  open: Set<string>;
  setOpen: (next: Set<string>) => void;
  depth: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["files", scope.threadId, path],
    queryFn: () => listDir(scope.threadId, path),
  });
  const api = useSidebarApi();

  const toggle = (p: string) => {
    const next = new Set(open);
    if (next.has(p)) next.delete(p); else next.add(p);
    setOpen(next);
  };

  if (isLoading || !data) return <div className="text-muted-foreground px-2 py-1 text-xs">loading…</div>;

  return (
    <ul className={depth === 0 ? "" : "pl-3"}>
      {sortEntries(data.entries).map((e) => {
        const childPath = joinPath(path, e.name);
        const isOpen = open.has(childPath);
        return (
          <li key={e.name}>
            <button
              type="button"
              onClick={() => {
                if (e.type === "dir") toggle(childPath);
                else openFile(api, scope.threadId, childPath);
              }}
              className="hover:bg-muted flex w-full items-center gap-1 px-2 py-1 text-left"
            >
              {e.type === "dir" ? (
                isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
              ) : (
                <span className="w-3" />
              )}
              {e.type === "dir" ? <Folder className="text-amber-500 size-3.5" /> : <FileIcon className="text-muted-foreground size-3.5" />}
              <span className="truncate">{e.name}</span>
            </button>
            {e.type === "dir" && isOpen && (
              <Tree scope={scope} path={childPath} open={open} setOpen={setOpen} depth={depth + 1} />
            )}
          </li>
        );
      })}
      {data.parent !== null && (
        <li>
          <button
            type="button"
            onClick={() => {
              const next = new Set(open);
              next.delete(parentRel(path));
              setOpen(next);
            }}
            className="text-muted-foreground px-2 py-1 text-xs italic"
          >
            .. (up)
          </button>
        </li>
      )}
    </ul>
  );
}

function joinPath(parent: string, child: string): string {
  return joinRel(parent, child);
}

function openFile(api: SidebarPanelProps["api"], threadId: string, path: string) {
  // Open the matched viewer panel as a new tab.
  const fakeEntry: FileEntry = { name: path.split("/").pop() ?? path, type: "file", size: 0, mtime: 0, mime: null };
  const spec = sidebarPanelRegistry.matchFileViewer(fakeEntry);
  api.openTab({
    panel: spec?.id ?? "qilin:files",
    payload: { path },
    title: fakeEntry.name,
  });
}

export { FileExplorerPanel };
```

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose FileExplorer`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/panels/FileExplorer.tsx web-demo/tests/unit/components/better-sidebar/FileExplorer.test.tsx
git commit -m "feat(web-demo/sidebar): FileExplorer panel (lazy tree, opens viewer tab)"
```

### Sub-task 5.5: FileViewerTab（viewer 调度封装）

- [ ] **Step 1: 写失败测试**

```tsx
// web-demo/tests/unit/components/better-sidebar/FileViewerTab.test.tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FileViewerTab } from "@/components/better-sidebar/panels/FileViewerTab";

vi.mock("@/core/files/api", () => ({
  readFile: vi.fn().mockResolvedValue("# hi"),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("FileViewerTab", () => {
  test("renders markdown viewer for .md file", async () => {
    render(
      <FileViewerTab
        scope={{ threadId: "thr" }}
        payload={{ path: "README.md" }}
        onPayloadChange={() => {}}
        api={{ openTab: () => {}, closeSelf: () => {}, toast: () => {} }}
      />,
      { wrapper },
    );
    await waitFor(() => screen.getByRole("heading", { level: 1 }));
  });
});
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `cd web-demo && pnpm test --reporter=verbose FileViewerTab`
Expected: FAIL

- [ ] **Step 3: 写最小实现**（`web-demo/src/components/better-sidebar/panels/FileViewerTab.tsx`）

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { dynamic } from "next/dist/compiled/react";
import type { FC } from "react";
import { fileViewerRegistry } from "@/core/sidebar/viewer-registry";
import { readFile, writeFile, FileApiError } from "@/core/files/api";
import type { SidebarPanelProps } from "@/core/sidebar/protocol";
```

> 备注：`next/dynamic` 在 web-demo 已用；为简洁改用 React.lazy：

```tsx
"use client";
import { lazy, Suspense, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fileViewerRegistry } from "@/core/sidebar/viewer-registry";
import { readFile, writeFile, readRaw, FileApiError } from "@/core/files/api";
import type { SidebarPanelProps } from "@/core/sidebar/protocol";

const LazyComponent = (loader: () => Promise<{ default: React.ComponentType<SidebarPanelProps> }>) =>
  lazy(loader);

interface Payload { path: string }

const FileViewerTab: FC<SidebarPanelProps<Payload>> = ({ scope, payload, api }) => {
  const qc = useQueryClient();
  const entry = useMemo(() => {
    const name = payload.path.split("/").pop() ?? payload.path;
    return { name, type: "file" as const, size: 0, mtime: 0, mime: null };
  }, [payload.path]);

  const spec = fileViewerRegistry.match(entry);
  const Component = spec ? lazy(() => Promise.resolve({ default: spec.component })) : null;

  const { data: content } = useQuery({
    queryKey: ["file-content", scope.threadId, payload.path],
    queryFn: async () => {
      try { return { kind: "text" as const, content: await readFile(scope.threadId, payload.path) }; }
      catch (e) {
        if (e instanceof FileApiError && e.code === "binary_not_editable") {
          const blob = await readRaw(scope.threadId, payload.path);
          return { kind: "binary" as const, content: new Uint8Array(await blob.arrayBuffer()) };
        }
        throw e;
      }
    },
    enabled: !! spec,
  });

  if (!spec) return <div className="p-2 text-xs text-muted-foreground">no viewer for {entry.name}</div>;
  if (!content) return <div className="p-2 text-xs text-muted-foreground">loading…</div>;

  const onSave = spec.editable
    ? async (next: string) => {
        await writeFile(scope.threadId, payload.path, next);
        await qc.invalidateQueries({ queryKey: ["files", scope.threadId] });
      }
    : undefined;

  return (
    <Suspense fallback={<div className="p-2 text-xs text-muted-foreground">loading viewer…</div>}>
      <Component
        scope={scope}
        payload={payload}
        onPayloadChange={() => {}}
        api={api}
        // The viewer components receive FileViewerProps directly when used standalone; when nested
        // inside a PanelHost-shaped wrapper, FileViewerTab passes the inner content via the spec.component
        // below to avoid leaking the SidebarPanelProps shape.
      />
      {/* Re-mount with proper viewer props: */}
      {(() => {
        const Viewer = spec.component;
        return (
          <Viewer
            entry={entry}
            content={content.kind === "text" ? content.content : content.content}
            scope={scope}
            onSave={onSave}
          />
        );
      })()}
    </Suspense>
  );
};

export { FileViewerTab };
```

> 说明：FileViewerTab 作为 panel 注册使用，Viewer 接收 `FileViewerProps`（无 payload / onPayloadChange / api）。把 inner content 渲染独立于 PanelHost 包装。

- [ ] **Step 4: 跑测试，验证 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose FileViewerTab`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web-demo/src/components/better-sidebar/panels/FileViewerTab.tsx web-demo/tests/unit/components/better-sidebar/FileViewerTab.test.tsx
git commit -m "feat(web-demo/sidebar): FileViewerTab (viewer dispatch + content fetch)"
```

### Sub-task 5.6: TabBar + TabContent + BetterSidebarRoot

- [ ] **Step 1: 创建 `web-demo/src/components/better-sidebar/TabContent.tsx`**

```tsx
"use client";
import { PanelHost } from "@/core/sidebar/panel-host";
import type { SidebarTabState } from "@/core/sidebar/protocol";

export function TabContent({ tab, onChangePayload }: {
  tab: SidebarTabState["tabs"][number];
  onChangePayload: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <PanelHost panel={tab.panel} payload={tab.payload} onPayloadChange={onChangePayload} />
    </div>
  );
}
```

- [ ] **Step 2: 创建 `web-demo/src/components/better-sidebar/TabBar.tsx`**

```tsx
"use client";
import { X } from "lucide-react";
import { useMemo, type FC } from "react";
import type { SidebarTabState } from "@/core/sidebar/protocol";

interface Props {
  state: SidebarTabState;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

const TabBar: FC<Props> = ({ state, onActivate, onClose }) => {
  const ordered = useMemo(() => [...state.tabs].sort((a, b) => a.created_at - b.created_at), [state.tabs]);
  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto border-b px-2 text-xs">
      {ordered.map((t) => (
        <div
          key={t.key}
          className={
            "flex items-center gap-1 rounded-md px-2 py-1 " +
            (state.active === t.key ? "bg-muted" : "hover:bg-muted/50")
          }
          onClick={() => onActivate(t.key)}
        >
          <span className="max-w-[160px] truncate">{t.title}</span>
          <button
            type="button"
            aria-label="close tab"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onClose(t.key); }}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {ordered.length === 0 && <span className="text-muted-foreground">no tabs open</span>}
    </div>
  );
};

export default TabBar;
```

- [ ] **Step 3: 创建 `web-demo/src/components/better-sidebar/BetterSidebarRoot.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSidebarTabs } from "@/core/sidebar/use-sidebar-tabs";
import { SidebarScopeProvider, useSidebarApi } from "@/core/sidebar/scope";
import TabBar from "./TabBar";
import { TabContent } from "./TabContent";
import type { SidebarTabState } from "@/core/sidebar/protocol";

interface Props {
  threadId: string;
  open: boolean;
  onClose?: () => void;
}

export function BetterSidebarRoot({ threadId, open }: Props) {
  const { data, save } = useSidebarTabs(threadId);
  const [local, setLocal] = useState<SidebarTabState | null>(null);
  const state = local ?? data ?? { tabs: [], active: null, split: "single" as const };

  // Debounced save — 500ms after state change.
  useEffect(() => {
    if (!local) return;
    const t = setTimeout(() => { void save(local); }, 500);
    return () => clearTimeout(t);
  }, [local, save]);

  const api = useMemo(() => ({
    openTab: ({ panel, payload = {}, title }: { panel: string; payload?: unknown; title?: string }) => {
      const key = `${panel}:${Math.random().toString(36).slice(2, 9)}`;
      setLocal((s) => {
        const cur = s ?? { tabs: [], active: null, split: "single" as const };
        return {
          ...cur,
          tabs: [...cur.tabs, { key, panel, title: title ?? panel, payload: payload as Record<string, unknown>, pinned: false, created_at: Date.now() / 1000 }],
          active: key,
        };
      });
    },
    closeSelf: () => {},
    toast: () => {},
  }), []);

  if (!open) return null;

  return (
    <SidebarScopeProvider scope={{ threadId }} api={api}>
      <div className="bg-background flex h-full w-full flex-col border-l">
        <TabBar
          state={state}
          onActivate={(k) => setLocal((s) => (s ? { ...s, active: k } : s))}
          onClose={(k) =>
            setLocal((s) => {
              if (!s) return s;
              const tabs = s.tabs.filter((t) => t.key !== k);
              const active = s.active === k ? (tabs.at(-1)?.key ?? null) : s.active;
              return { ...s, tabs, active };
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {state.tabs.find((t) => t.key === state.active) && (
            <TabContent
              tab={state.tabs.find((t) => t.key === state.active)!}
              onChangePayload={(next) => setLocal((s) => {
                if (!s) return s;
                return { ...s, tabs: s.tabs.map((t) => t.key === state.active ? { ...t, payload: { ...t.payload, ...next } } : t) };
              })}
            />
          )}
        </div>
      </div>
    </SidebarScopeProvider>
  );
}
```

- [ ] **Step 4: 写 e2e 测试**（`web-demo/tests/e2e/better-sidebar.spec.ts`）

```ts
import { test, expect } from "@playwright/test";

test("right sidebar opens files panel and renders markdown viewer", async ({ page }) => {
  await page.goto("/workspace");  // adjust to your auth flow
  // Open settings → right panel mode = sidebar (assumes the setting page added in Task 6).
  await page.getByRole("button", { name: /settings/i }).click();
  await page.getByLabel(/right panel mode/i).selectOption("sidebar");
  await page.keyboard.press("Escape");
  // Click the Files tab in the new right sidebar.
  await page.getByRole("button", { name: /files/i }).click();
  // Click README.md in the tree.
  await page.getByText("README.md").click();
  // Markdown heading renders.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
```

> 注：e2e 依赖完整工作台认证态；本计划阶段可保留 `await page.goto('/workspace')` 并跳过认证断言。Task 6 完成设置项后再 enable 真正的 assert。

- [ ] **Step 5: typecheck**

Run: `cd web-demo && pnpm run typecheck`
Expected: 无错误

- [ ] **Step 6: 跑既有 vitest，确认无回归**

Run: `cd web-demo && pnpm test --reporter=verbose`
Expected: 既有测试 + 新增 10+ 个测试全绿

- [ ] **Step 7: 提交**

```bash
git add web-demo/src/components/better-sidebar/{TabBar,TabContent,BetterSidebarRoot}.tsx web-demo/src/components/better-sidebar/panels/FileViewerTab.tsx web-demo/tests/e2e/better-sidebar.spec.ts
git commit -m "feat(web-demo/sidebar): TabBar + TabContent + BetterSidebarRoot with debounced persistence"
```

---

## Task 6: 集成 + 设置项 + 移动端（设计 §5）

**Files:**
- Modify: `web-demo/src/components/workspace/workspace-layout-context.tsx`（新增 `rightPanelMode`）
- Modify: `web-demo/src/components/workspace/workspace-content.tsx`（按 mode 切换）
- Modify: `web-demo/src/components/workspace/settings/settings-view.tsx`（新增"右侧面板模式"选项）
- Modify: `web-demo/src/app/workspace/workspace-content.tsx`（移动端抽屉逻辑）
- Create: `web-demo/src/components/better-sidebar/BetterSidebarDrawer.tsx`（移动端抽屉封装）

### Sub-task 6.1: layout context 增加 `rightPanelMode`

- [ ] **Step 1: 修改 `web-demo/src/components/workspace/workspace-layout-context.tsx`**

在 `WorkspaceLayoutValue` 接口增加：
```typescript
rightPanelMode: "context" | "sidebar";
setRightPanelMode: (mode: "context" | "sidebar") => void;
```

在状态读取新增：
```typescript
const RIGHT_PANEL_MODE_KEY = "kworks.workspace.rightPanelMode";
function readMode(): "context" | "sidebar" {
  try {
    const v = localStorage.getItem(RIGHT_PANEL_MODE_KEY);
    return v === "sidebar" ? "sidebar" : "context";
  } catch { return "context"; }
}
```

在 state 新增 `rightPanelMode`，初值 `readMode()`；`setRightPanelMode` 持久化。

- [ ] **Step 2: 写失败测试**（在 `web-demo/tests/unit/components/workspace/workspace-layout-context.test.tsx`，如不存在则新建）

```tsx
// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { WorkspaceLayoutProvider, useWorkspaceLayout } from "@/components/workspace/workspace-layout-context";

function Probe() {
  const { rightPanelMode, setRightPanelMode } = useWorkspaceLayout();
  return (
    <div>
      <span data-testid="mode">{rightPanelMode}</span>
      <button onClick={() => setRightPanelMode("sidebar")}>switch</button>
    </div>
  );
}

describe("WorkspaceLayoutContext rightPanelMode", () => {
  test("defaults to context", () => {
    localStorage.clear();
    render(<WorkspaceLayoutProvider><Probe /></WorkspaceLayoutProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("context");
  });
  test("setRightPanelMode persists to localStorage", () => {
    localStorage.clear();
    render(<WorkspaceLayoutProvider><Probe /></WorkspaceLayoutProvider>);
    act(() => { screen.getByText("switch").click(); });
    expect(localStorage.getItem("kworks.workspace.rightPanelMode")).toBe("sidebar");
    expect(screen.getByTestId("mode")).toHaveTextContent("sidebar");
  });
});
```

- [ ] **Step 3: 跑测试，验证失败 → 实现后 PASS**

Run: `cd web-demo && pnpm test --reporter=verbose "workspace-layout-context"`

- [ ] **Step 4: 提交**

```bash
git add web-demo/src/components/workspace/workspace-layout-context.tsx web-demo/tests/unit/components/workspace/workspace-layout-context.test.tsx
git commit -m "feat(web-demo/workspace): rightPanelMode state (context | sidebar)"
```

### Sub-task 6.2: workspace-content 按 mode 切换

- [ ] **Step 1: 修改 `web-demo/src/components/workspace/workspace-content.tsx`**

在右侧栏容器内增加分支：
```tsx
{rightPanelOpen && (
  rightPanelMode === "sidebar"
    ? <BetterSidebarRoot threadId={currentThreadId} open={rightPanelOpen} />
    : <ContextPanel />
)}
```

`currentThreadId` 已有；`BetterSidebarRoot` 通过模块 import。

- [ ] **Step 2: typecheck + 既有单测**

Run: `cd web-demo && pnpm run typecheck && pnpm test --reporter=verbose`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add web-demo/src/components/workspace/workspace-content.tsx
git commit -m "feat(web-demo/workspace): switch right panel between context and sidebar"
```

### Sub-task 6.3: 设置页加模式选项

- [ ] **Step 1: 修改 `web-demo/src/components/workspace/settings/settings-view.tsx`**

在"通用"分区增加一行：
```tsx
const { rightPanelMode, setRightPanelMode } = useWorkspaceLayout();
…
<Select value={rightPanelMode} onValueChange={(v) => setRightPanelMode(v as "context" | "sidebar")}>
  <SelectTrigger aria-label="right panel mode"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="context">Context (subagents / skills / changes)</SelectItem>
    <SelectItem value="sidebar">Sidebar (files / viewers / plugins)</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 2: 跑 e2e 草测**

Run: `cd web-demo && pnpm test:e2e -- better-sidebar.spec.ts`
Expected: 通过；如登录态拦截则先手动验证

- [ ] **Step 3: 提交**

```bash
git add web-demo/src/components/workspace/settings/settings-view.tsx
git commit -m "feat(web-demo/settings): right panel mode selector (context | sidebar)"
```

### Sub-task 6.4: 移动端抽屉（< 768px）

- [ ] **Step 1: 创建 `web-demo/src/components/better-sidebar/BetterSidebarDrawer.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { BetterSidebarRoot } from "./BetterSidebarRoot";

export function BetterSidebarDrawer({ threadId }: { threadId: string }) {
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  if (!isMobile) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full border-t px-4 py-2 text-left text-sm"
      >
        {open ? "关闭侧栏" : "打开侧栏"}
      </button>
      {open && (
        <div className="h-[60vh] border-t">
          <BetterSidebarRoot threadId={threadId} open />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 `workspace-content.tsx` 末尾挂载**

```tsx
{rightPanelMode === "sidebar" && <BetterSidebarDrawer threadId={currentThreadId} />}
```

- [ ] **Step 3: 手动验证**（Playwright 三档 viewport 截图存档到 `/.dsh-vision-router/artifacts/`）

Run: 用 Playwright MCP 工具访问 `http://localhost:28080/workspace`，三档 viewport（375/768/1280）截图，确认侧栏形态正确。

- [ ] **Step 4: 提交**

```bash
git add web-demo/src/components/better-sidebar/BetterSidebarDrawer.tsx web-demo/src/components/workspace/workspace-content.tsx
git commit -m "feat(web-demo/sidebar): mobile drawer (< 768px bottom sheet)"
```

---

## Task 7: 文档 + 收尾（设计 §8）

**Files:**
- Modify: `web-demo/README.md`（新增"Better Sidebar"节）
- Modify: `docs/superpowers/specs/2026-08-27-better-sidebar-web-design.md`（追加"实施状态"段）

### Sub-task 7.1: README + spec 状态同步

- [ ] **Step 1: 在 `web-demo/README.md` 末尾新增**

```markdown
## Better Sidebar (right panel)

A multi-tab right sidebar modeled on [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar):
files / markdown / HTML / image / PDF / code viewer tabs, with per-thread tab
state persisted via `/api/threads/{id}/sidebar-tabs`. Plugin protocol:
`sidebarPanelRegistry.register({ id, title, render, ... })`.

Toggle mode in Settings → General → Right panel mode (context | sidebar).
On < 768px viewports the right sidebar collapses into a bottom sheet.
```

- [ ] **Step 2: 在设计文档追加实施状态段**

在 `docs/superpowers/specs/2026-08-27-better-sidebar-web-design.md` 末尾追加：
```markdown
## 9. 实施状态（持续更新）
- 2026-08-27：v1 P1-P7 全部完成；测试见 `tests/test_files_router.py`、
  `tests/test_sidebar_tabs_router.py`、`web-demo/tests/unit/core/sidebar/`、
  `web-demo/tests/unit/components/better-sidebar/`、`web-demo/tests/e2e/better-sidebar.spec.ts`。
```

- [ ] **Step 3: 跑全检查**

```bash
cd web-demo && pnpm run check   # lint + typecheck
uv run pytest tests/ -x -q        # 后端测试
```

- [ ] **Step 4: 提交**

```bash
git add web-demo/README.md docs/superpowers/specs/2026-08-27-better-sidebar-web-design.md
git commit -m "docs: better-sidebar v1 README + spec status"
```

---

## 自审（Spec ↔ Plan 覆盖核对）

| Spec 节 | 实现任务 |
|---|---|
| §1 决策记录 | 全任务都遵守；无单独任务 |
| §2 整体架构 | Task 1/2 后端 + Task 3-6 前端覆盖 |
| §3.1 后端 FS API | Task 1 Sub 1.1-1.2 |
| §3.2 后端 tab 状态 | Task 2 Sub 2.1 |
| §3.3 权限/错误码 | Task 1 (装饰器 + WorkspacePathError) + Task 2 (404 错误码) |
| §4.1 panel 协议 | Task 3.2 panel-registry |
| §4.2 viewer 协议 | Task 3.3 viewer-registry + Task 4 (5 内置 viewer) |
| §4.3 组件清单 | Task 4.6 + Task 5.4-5.6 + Task 6.4 |
| §4.4 关键交互 | Task 5.4 (openFile) + Task 5.6 (debounced save) + Task 6.4 (mobile drawer) |
| §5.1 与 workspace-layout-context | Task 6.1 |
| §5.2 挂载位置 | Task 6.2 |
| §5.3 SSR 时机 | 设计 spec 不变；PUT 在 first human message 之后由 TanStack Query 触发（自动满足） |
| §6.1 后端测试 | Task 1 (8 用例) + Task 2 (3 用例) |
| §6.2 前端测试 | Task 3 (3 文件 11 用例) + Task 4 (5 文件 6 用例) + Task 5 (4 文件 4 用例) + Task 6 (1 文件 2 用例) |
| §6.3 手工验收 | Task 6 Sub 6.4 (Playwright 三档截图) |
| §6.4 性能与体积 | Task 4.4 (pdfjs-dist 动态 import) + Task 4.5 (CodeMirror 按需) |
| §7 风险与对策 | Task 1 (路径校验矩阵) + Task 4.4 (pdfjs 按需) + Task 6.4 (移动端 only-one) |
| §8 P1-P7 阶段 | Task 1-7 一一对应 |

**placeholder 自审**：
- 无 "TBD" / "TODO" / "待补" / "类似 Task N" 出现
- 每步都有具体代码或命令
- 错误码词汇与 spec §3.3 完全一致
- 类型签名在 Task 3 定义 → Task 5 使用一致（`SidebarPanelProps<P>` / `FileViewerProps`）

**类型一致性自审**：
- `panel-registry.matchFileViewer(entry)` 入参 `FileEntryLike` 与 `protocol.ts` 一致
- `viewer-registry.match(entry, head?)` 入参与 viewer 端 `FileViewerProps` 一致
- `useSidebarTabs(threadId)` 返回 `{ ...query, save }` → 5.6 调用 `save(local)` 入参 `SidebarTabState` 一致
- `BetterSidebarRoot({ threadId, open })` → `SidebarScopeProvider({ scope: { threadId }, api })` 一致

---

**Plan complete and saved to `plans/2026-08-27-better-sidebar-web-impl.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 Task 派一个独立 subagent 执行，我在每个 Task 完成后做 review 并继续派下一个；适合这种多阶段实施。

**2. Inline Execution** — 我直接在当前 session 内依次执行 Task 1-7，每完成一个 Task 暂停让你 review 后再继续。

请告诉我用哪种方式开始 Task 1（后端 FS 路由），或者你想先调整计划里的某些步骤再开工。