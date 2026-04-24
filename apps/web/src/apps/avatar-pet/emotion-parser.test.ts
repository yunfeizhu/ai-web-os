import { describe, expect, it } from "vitest";

import { getLive2DExpressionPlan } from "./emotion-map";
import {
  AVATAR_EMOTIONS,
  parseAvatarEmotions,
  stripAvatarEmotionTags,
} from "./emotion-parser";

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

  it("normalizes uppercase emotion labels", () => {
    expect(parseAvatarEmotions("[emotion: HAPPY]Hi")).toEqual({
      text: "Hi",
      emotions: ["happy"],
      currentEmotion: "happy",
    });
  });

  it("allows whitespace before the emotion tag colon", () => {
    expect(parseAvatarEmotions("[emotion : happy]Hi")).toEqual({
      text: "Hi",
      emotions: ["happy"],
      currentEmotion: "happy",
    });
  });

  it("allows whitespace around the emotion tag wrapper", () => {
    expect(parseAvatarEmotions("[ emotion:happy ]Hi")).toEqual({
      text: "Hi",
      emotions: ["happy"],
      currentEmotion: "happy",
    });
  });

  it("strips empty emotion labels without adding them to state", () => {
    expect(parseAvatarEmotions("[emotion:]Hi")).toEqual({
      text: "Hi",
      emotions: [],
      currentEmotion: "neutral",
    });
  });

  it("preserves known emotion order across mixed casing and spacing", () => {
    expect(
      parseAvatarEmotions(
        "[ emotion: HAPPY ]Hi[emotion : surprised] there[emotion:RELAXED ]",
      ),
    ).toEqual({
      text: "Hi there",
      emotions: ["happy", "surprised", "relaxed"],
      currentEmotion: "relaxed",
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

describe("getLive2DExpressionPlan", () => {
  it("maps every avatar emotion to expression and motion candidates", () => {
    for (const emotion of AVATAR_EMOTIONS) {
      const plan = getLive2DExpressionPlan(emotion);

      expect(plan.expressionNames.length).toBeGreaterThan(0);
      expect(plan.motionGroups.length).toBeGreaterThan(0);
    }
  });
});
