import { describe, expect, it } from "vitest";

import { getMacosAppIconSrc } from "./appIconAssets";

describe("macOS app icon assets", () => {
  it("returns project-local png icons for built-in apps", () => {
    expect(getMacosAppIconSrc("ai-chat")).toBe("/icons/macos/ai-chat.png");
    expect(getMacosAppIconSrc("settings")).toBe("/icons/macos/settings.png");
  });

  it("returns undefined for unknown app ids", () => {
    expect(getMacosAppIconSrc("unknown")).toBeUndefined();
  });
});
