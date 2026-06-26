import type { AvatarEmotion } from "./emotion-parser";

export type Live2DExpressionPlan = {
  expressionNames: readonly string[];
  motionGroups: readonly string[];
};

export const EMOTION_TO_LIVE2D: Record<AvatarEmotion, Live2DExpressionPlan> = {
  neutral: {
    expressionNames: ["neutral", "default", "exp_01"],
    motionGroups: ["Idle"],
  },
  happy: {
    expressionNames: ["happy", "smile", "joy", "exp_04"],
    motionGroups: ["TapBody", "Happy", "Idle"],
  },
  sad: {
    expressionNames: ["sad", "troubled", "exp_05", "exp_07"],
    motionGroups: ["Sad", "Idle"],
  },
  angry: {
    expressionNames: ["angry", "mad", "exp_08"],
    motionGroups: ["Angry", "Idle"],
  },
  surprised: {
    expressionNames: ["surprised", "surprise", "exp_07", "exp_04"],
    motionGroups: ["Surprised", "Idle"],
  },
  relaxed: {
    expressionNames: ["relaxed", "soft", "default", "exp_01"],
    motionGroups: ["Idle"],
  },
  closed: {
    expressionNames: ["closed", "sleep", "eyes_closed", "exp_03", "exp_02"],
    motionGroups: ["Idle"],
  },
};

export function getLive2DExpressionPlan(
  emotion: AvatarEmotion,
): Live2DExpressionPlan {
  return EMOTION_TO_LIVE2D[emotion] ?? EMOTION_TO_LIVE2D.neutral;
}
