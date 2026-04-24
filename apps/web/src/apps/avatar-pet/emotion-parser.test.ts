import { describe, expect, it } from "vitest";

import { parseAvatarEmotions, stripAvatarEmotionTags } from "./emotion-parser";

describe("parseAvatarEmotions", () => {
  it("extracts a known happy emotion and strips the tag", () => {
    expect(parseAvatarEmotions("[emotion:happy]当然可以。")).toEqual({
      text: "当然可以。",
      emotions: ["happy"],
      currentEmotion: "happy",
    });
  });

  it("keeps multiple known emotions in encounter order", () => {
    expect(
      parseAvatarEmotions(
        "[emotion:neutral]我看看。[emotion:surprised]发现一个问题。",
      ),
    ).toEqual({
      text: "我看看。发现一个问题。",
      emotions: ["neutral", "surprised"],
      currentEmotion: "surprised",
    });
  });

  it("strips unknown emotion labels without adding them to state", () => {
    expect(parseAvatarEmotions("[emotion:excited]你好")).toEqual({
      text: "你好",
      emotions: [],
      currentEmotion: "neutral",
    });
  });

  it("defaults to neutral when there are no emotion tags", () => {
    expect(parseAvatarEmotions("你好")).toEqual({
      text: "你好",
      emotions: [],
      currentEmotion: "neutral",
    });
  });
});

describe("stripAvatarEmotionTags", () => {
  it("strips known and unknown emotion tags", () => {
    expect(
      stripAvatarEmotionTags("[emotion:happy]你好[emotion:excited]呀"),
    ).toBe("你好呀");
  });
});
