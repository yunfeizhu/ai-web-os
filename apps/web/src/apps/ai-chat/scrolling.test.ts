import { describe, expect, it, vi } from "vitest";

import { scrollMessagesToBottom } from "./scrolling";

describe("scrollMessagesToBottom", () => {
  it("scrolls only the message container instead of asking the browser to reveal a child", () => {
    const scrollTo = vi.fn();
    const container = {
      scrollHeight: 2400,
      scrollTo,
    } as unknown as Pick<HTMLElement, "scrollHeight" | "scrollTo">;

    scrollMessagesToBottom(container, "instant");

    expect(scrollTo).toHaveBeenCalledWith({
      top: 2400,
      behavior: "instant",
    });
  });

  it("does nothing before the container ref is mounted", () => {
    expect(() => scrollMessagesToBottom(null, "smooth")).not.toThrow();
  });
});
