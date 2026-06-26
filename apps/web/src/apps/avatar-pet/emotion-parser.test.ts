import { describe, expect, it } from "vitest";

import { getLive2DExpressionPlan } from "./emotion-map";
import {
  AVATAR_EMOTIONS,
  parseAvatarCues,
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

  it("removes blank lines left behind by a leading emotion tag", () => {
    expect(parseAvatarEmotions("[emotion:sad]\n\n辛苦啦，先喘口气。")).toEqual({
      text: "辛苦啦，先喘口气。",
      emotions: ["sad"],
      currentEmotion: "sad",
    });
  });
});

describe("parseAvatarCues", () => {
  it("extracts emotion and motion tags while hiding them from chat text", () => {
    expect(
      parseAvatarCues("[emotion:happy][motion:heart]给你画个小爱心。"),
    ).toEqual({
      text: "给你画个小爱心。",
      emotions: ["happy"],
      currentEmotion: "happy",
      motions: ["heart"],
    });
  });

  it("supports an explicit closed-eye expression cue", () => {
    expect(parseAvatarCues("[emotion:closed]我闭上眼睛啦。")).toEqual({
      text: "我闭上眼睛啦。",
      emotions: ["closed"],
      currentEmotion: "closed",
      motions: [],
    });
  });

  it("strips unknown motion tags without triggering actions", () => {
    expect(parseAvatarCues("[motion:dance]先不跳舞。")).toEqual({
      text: "先不跳舞。",
      emotions: [],
      currentEmotion: "neutral",
      motions: [],
    });
  });
});

describe("stripAvatarEmotionTags", () => {
  it("strips known and unknown emotion tags", () => {
    expect(
      stripAvatarEmotionTags("[emotion:happy]你好[emotion:excited]呀"),
    ).toBe("你好呀");
  });

  it("does not leave leading blank lines after stripping an opening tag", () => {
    expect(stripAvatarEmotionTags("[emotion:relaxed]\n\n我在。")).toBe("我在。");
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

  it("includes numbered Mao Pro expression fallbacks", () => {
    expect(getLive2DExpressionPlan("neutral").expressionNames).toContain(
      "exp_01",
    );
    expect(getLive2DExpressionPlan("happy").expressionNames).toContain(
      "exp_04",
    );
    expect(getLive2DExpressionPlan("sad").expressionNames).toEqual(
      expect.arrayContaining(["exp_05", "exp_07"]),
    );
    expect(getLive2DExpressionPlan("angry").expressionNames).toContain(
      "exp_08",
    );
    expect(getLive2DExpressionPlan("surprised").expressionNames).toContain(
      "exp_07",
    );
    expect(getLive2DExpressionPlan("relaxed").expressionNames).toContain(
      "exp_01",
    );
    expect(getLive2DExpressionPlan("closed").expressionNames).toEqual(
      expect.arrayContaining(["exp_02", "exp_03"]),
    );
  });

  it("does not use closed-eye Mao Pro expressions for persistent chat emotions", () => {
    for (const emotion of AVATAR_EMOTIONS.filter((item) => item !== "closed")) {
      const expressionNames = getLive2DExpressionPlan(emotion).expressionNames;

      expect(expressionNames).not.toContain("exp_02");
      expect(expressionNames).not.toContain("exp_03");
    }
  });
});
