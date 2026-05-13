import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ToolCallDisplay } from "./ToolCallDisplay";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ToolCallDisplay", () => {
  let container: HTMLDivElement;
  let root: Root;
  const garbledSyntaxError = "\u7487\ue15f\u7876\u95bf\u6b12\ue1e4";

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders tool results without rewriting garbled source text", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolCalls={[
            {
              id: "call_1",
              name: "calculator",
              args: { expression: "1 + 1" },
              result: garbledSyntaxError,
              error: true,
              status: "error",
            },
          ]}
        />,
      );
    });

    const toggle = container.querySelector("button");
    expect(toggle).not.toBeNull();

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(garbledSyntaxError);
    expect(container.textContent).not.toContain("语法错误");
  });
});
