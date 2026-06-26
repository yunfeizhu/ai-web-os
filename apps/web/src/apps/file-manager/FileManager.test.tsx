import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/backend";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import { FileManager } from "./FileManager";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/backend", () => ({
  apiFetch: vi.fn(),
  buildApiUrl: (path: string) => `http://localhost:8000/api/v1${path}`,
}));

const apiFetchMock = vi.mocked(apiFetch);

describe("FileManager", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/files/tree") {
        return { tree: [], root_name: "Root" };
      }
      return { entries: [] };
    });
    useDesktopStore.setState({ apps: {} });
    useWindowStore.setState({
      windows: {},
      focusOrder: [],
      nextZIndex: 100,
      closeGuards: {},
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("loads the initial folder path from app state", async () => {
    const initialPath = "/root/Desktop/新建文件夹";

    await act(async () => {
      root.render(<FileManager appState={{ initialPath }} />);
    });

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/files?path=${encodeURIComponent(initialPath)}`,
    );
  });

  it("renders directory entries with the macOS folder png icon", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/files/tree") {
        return { tree: [], root_name: "Root" };
      }
      return {
        path: "/",
        entries: [
          {
            id: "folder-1",
            name: "新建文件夹",
            path: "/新建文件夹",
            parent_path: "/",
            kind: "dir",
            mime_type: "inode/directory",
            size: 0,
          },
        ],
      };
    });

    await act(async () => {
      root.render(<FileManager />);
    });

    await act(async () => {});

    const icon = container.querySelector<HTMLImageElement>(
      '[data-testid="file-manager-folder-icon-image"]',
    );

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBe("/icons/macos/folder.png");
  });

  it("renders common entry types with macOS-style transparent png icons", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/files/tree") {
        return {
          root_name: "Root",
          tree: [{ name: "本地磁盘 (C:)", path: "/C", children: [] }],
        };
      }
      return {
        path: "/",
        entries: [
          makeEntry({ id: "drive-c", name: "本地磁盘 (C:)", path: "/C", kind: "dir" }),
          makeEntry({ id: "image", name: "photo.png", mime_type: "image/png" }),
          makeEntry({ id: "archive", name: "archive.zip", mime_type: "application/zip" }),
          makeEntry({
            id: "document",
            name: "report.docx",
            mime_type:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          makeEntry({ id: "code", name: "main.ts", mime_type: "text/typescript" }),
          makeEntry({ id: "json", name: "package.json", mime_type: "application/json" }),
          makeEntry({
            id: "spreadsheet",
            name: "budget.xlsx",
            mime_type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          makeEntry({ id: "audio", name: "song.mp3", mime_type: "audio/mpeg" }),
          makeEntry({ id: "video", name: "movie.mp4", mime_type: "video/mp4" }),
          makeEntry({ id: "config", name: ".env", mime_type: "text/plain" }),
          makeEntry({ id: "shortcut", name: "site.url", mime_type: "text/plain" }),
          makeEntry({ id: "whiteboard", name: "idea.whiteboard.json", mime_type: "application/json" }),
        ],
      };
    });

    await act(async () => {
      root.render(<FileManager />);
    });

    await act(async () => {});

    const expectedSources = {
      drive: "/icons/macos/file-manager/drive.png",
      image: "/icons/macos/file-manager/image.png",
      archive: "/icons/macos/file-manager/archive.png",
      document: "/icons/macos/file-manager/document.png",
      code: "/icons/macos/file-manager/code.png",
      json: "/icons/macos/file-manager/json.png",
      spreadsheet: "/icons/macos/file-manager/spreadsheet.png",
      audio: "/icons/macos/file-manager/audio.png",
      video: "/icons/macos/file-manager/video.png",
      config: "/icons/macos/file-manager/config.png",
      shortcut: "/icons/macos/file-manager/shortcut.png",
      whiteboard: "/icons/macos/file-manager/whiteboard.png",
    };

    for (const [kind, src] of Object.entries(expectedSources)) {
      const icon = container.querySelector<HTMLImageElement>(
        `[data-icon-kind="${kind}"]`,
      );

      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("src")).toBe(src);
    }
  });

  it("keeps selected entry actions inside a compact toolbar menu", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/files/tree") {
        return { tree: [], root_name: "Root" };
      }
      return {
        path: "/",
        entries: [
          makeEntry({
            id: "document",
            name: "notes.txt",
            mime_type: "text/plain",
          }),
        ],
      };
    });

    await act(async () => {
      root.render(<FileManager />);
    });

    await act(async () => {});

    const entryButton = getButtonByText(container, "notes.txt");
    expect(entryButton).not.toBeNull();

    await act(async () => {
      entryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toolbar = container.querySelector('[data-testid="file-manager-toolbar"]');

    expect(toolbar).not.toBeNull();
    expect(toolbar?.textContent).not.toContain("重命名");
    expect(toolbar?.textContent).not.toContain("移动");
    expect(toolbar?.textContent).not.toContain("复制");
    expect(toolbar?.textContent).not.toContain("删除");

    const moreButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="file-manager-toolbar-more"]',
    );
    expect(moreButton).not.toBeNull();

    await act(async () => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const menu = container.querySelector('[data-testid="file-manager-toolbar-menu"]');
    expect(menu?.textContent).toContain("重命名");
    expect(menu?.textContent).toContain("移动");
    expect(menu?.textContent).toContain("复制");
    expect(menu?.textContent).toContain("删除");
  });
});

function makeEntry(overrides: Partial<{
  id: string;
  name: string;
  path: string;
  parent_path: string;
  kind: "file" | "dir";
  mime_type: string | null;
  size: number;
}> = {}) {
  const id = overrides.id ?? "entry";
  const name = overrides.name ?? `${id}.txt`;
  return {
    id,
    name,
    path: overrides.path ?? `/${name}`,
    parent_path: overrides.parent_path ?? "/",
    kind: overrides.kind ?? "file",
    mime_type: overrides.mime_type ?? "text/plain",
    size: overrides.size ?? 1024,
  };
}

function getButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  ) ?? null;
}
