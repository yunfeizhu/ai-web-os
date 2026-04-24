import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AVATAR_DEFAULT_SIZE } from "@/apps/avatar-pet/avatar-layout";
import { useAvatarStore } from "@/stores/avatarStore";
import { AvatarPet } from "./AvatarPet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-rnd", () => ({
  Rnd: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="avatar-pet-rnd">{children}</div>
  ),
}));

vi.mock("./AvatarBubble", () => ({
  AvatarBubble: () => <div data-testid="avatar-bubble">bubble</div>,
}));

vi.mock("./Live2DCanvas", () => ({
  Live2DCanvas: () => <div data-testid="live2d-canvas">live2d</div>,
}));

describe("AvatarPet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 24, y: 488 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "/avatar/live2d/hiyori_free_zh/runtime/hiyori_free_t08.model3.json",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",
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
    vi.restoreAllMocks();
  });

  it("renders the desktop pet with a fully transparent shell and stage", () => {
    act(() => {
      root.render(<AvatarPet />);
    });

    const shell = container.querySelector<HTMLElement>(
      '[data-testid="avatar-pet-shell"]',
    );
    const stage = container.querySelector<HTMLElement>(
      '[data-testid="avatar-pet-stage"]',
    );
    const buttons = container.querySelectorAll("button");

    expect(shell).not.toBeNull();
    expect(shell?.style.background).toBe("transparent");
    expect(shell?.style.border).toBe("0px solid transparent");
    expect(shell?.style.backdropFilter).toBe("none");

    expect(stage).not.toBeNull();
    expect(stage?.style.background).toBe("transparent");
    expect(stage?.style.border).toBe("0px solid transparent");

    expect(buttons).toHaveLength(2);
  });

  it("only reveals floating controls when the avatar is hovered or focused", () => {
    act(() => {
      root.render(<AvatarPet />);
    });

    const controls = container.querySelector<HTMLElement>(
      '[data-testid="avatar-pet-controls"]',
    );

    expect(controls).not.toBeNull();
    expect(controls?.className).toContain("opacity-0");
    expect(controls?.className).toContain("group-hover:opacity-100");
    expect(controls?.className).toContain("group-focus-within:opacity-100");
  });

  it("reveals a drag boundary without adding a background", () => {
    act(() => {
      root.render(<AvatarPet />);
    });

    const dragFrame = container.querySelector<HTMLElement>(
      '[data-testid="avatar-pet-drag-frame"]',
    );

    expect(dragFrame).not.toBeNull();
    expect(dragFrame?.style.background).toBe("transparent");
    expect(dragFrame?.className).toContain("opacity-0");
    expect(dragFrame?.className).toContain("group-hover:opacity-100");
    expect(dragFrame?.className).toContain("group-focus-within:opacity-100");
  });

  it("does not open the chat bubble when the Live2D stage is clicked", () => {
    act(() => {
      root.render(<AvatarPet />);
    });

    const live2dCanvas = container.querySelector<HTMLElement>(
      '[data-testid="live2d-canvas"]',
    );

    expect(live2dCanvas).not.toBeNull();

    act(() => {
      live2dCanvas?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="avatar-bubble"]'),
    ).toBeNull();
  });

  it("opens the chat bubble from the top-left message button", () => {
    act(() => {
      root.render(<AvatarPet />);
    });

    const messageButton = container.querySelector<HTMLButtonElement>(
      '[data-avatar-control="true"]',
    );

    expect(messageButton).not.toBeNull();

    act(() => {
      messageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="avatar-bubble"]'),
    ).not.toBeNull();
  });
});
