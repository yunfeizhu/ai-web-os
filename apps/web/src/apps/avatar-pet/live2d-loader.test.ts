import { describe, expect, it } from "vitest";

import {
  classifyLive2DSource,
  findModelSettingsPath,
  isLive2DZipSource,
} from "./live2d-loader";

describe("classifyLive2DSource", () => {
  it("classifies model3 json sources", () => {
    const source = "/avatar/live2d/hiyori/hiyori.model3.json";

    expect(classifyLive2DSource(source)).toEqual({
      kind: "model3-json",
      source,
    });
  });

  it("classifies zip sources", () => {
    const source = "/avatar/live2d/hiyori.zip";

    expect(classifyLive2DSource(source)).toEqual({
      kind: "zip",
      source,
    });
  });

  it("classifies empty sources as missing", () => {
    expect(classifyLive2DSource("")).toEqual({
      kind: "missing",
      source: "",
    });
  });

  it("trims sources before classifying and returning them", () => {
    expect(classifyLive2DSource("  /avatar/live2d/HIYORI.MODEL3.JSON  ")).toEqual({
      kind: "model3-json",
      source: "/avatar/live2d/HIYORI.MODEL3.JSON",
    });
  });

  it("classifies unrecognized non-empty sources as unknown", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori.txt")).toEqual({
      kind: "unknown",
      source: "/avatar/live2d/hiyori.txt",
    });
  });
});

describe("isLive2DZipSource", () => {
  it("returns true for zip sources", () => {
    expect(isLive2DZipSource("/x/y.zip")).toBe(true);
  });

  it("returns false for model3 json sources", () => {
    expect(isLive2DZipSource("/x/y.model3.json")).toBe(false);
  });

  it("matches zip extensions case-insensitively after trimming", () => {
    expect(isLive2DZipSource("  /x/y.ZIP  ")).toBe(true);
  });
});

describe("findModelSettingsPath", () => {
  it("prefers model3 json settings over model json settings", () => {
    expect(
      findModelSettingsPath(["foo/model.model.json", "foo/model.model3.json"]),
    ).toBe("foo/model.model3.json");
  });

  it("normalizes backslashes in the returned settings path", () => {
    expect(findModelSettingsPath(["foo\\bar\\model.model3.json"])).toBe(
      "foo/bar/model.model3.json",
    );
  });

  it("falls back to model json settings when model3 json is absent", () => {
    expect(findModelSettingsPath(["foo/model.model.json"])).toBe(
      "foo/model.model.json",
    );
  });

  it("returns null when no model settings path is present", () => {
    expect(findModelSettingsPath(["foo/readme.txt", "foo/texture.png"])).toBeNull();
  });
});
