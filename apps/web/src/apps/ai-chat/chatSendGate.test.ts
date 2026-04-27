import { describe, expect, it } from "vitest";

import { shouldSuppressDuplicateSubmit } from "./chatSendGate";

describe("shouldSuppressDuplicateSubmit", () => {
  it("blocks the same message while it is already in flight", () => {
    expect(
      shouldSuppressDuplicateSubmit({
        content: "300033咋样",
        inFlightContent: "300033咋样",
        queuedContent: null,
      }),
    ).toBe(true);
  });

  it("blocks the same message when it is already queued", () => {
    expect(
      shouldSuppressDuplicateSubmit({
        content: "300033咋样",
        inFlightContent: "帮我查一下行情",
        queuedContent: "300033咋样",
      }),
    ).toBe(true);
  });

  it("allows a different message to be queued behind the running request", () => {
    expect(
      shouldSuppressDuplicateSubmit({
        content: "再看一下新闻面",
        inFlightContent: "300033咋样",
        queuedContent: null,
      }),
    ).toBe(false);
  });
});
