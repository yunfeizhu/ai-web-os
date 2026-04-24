import type { AvatarEmotion } from "./emotion-parser";

export type Live2DExpressionPlan = {
  expressionNames: string[];
  motionGroups: string[];
};

export const EMOTION_TO_LIVE2D: Record<AvatarEmotion, Live2DExpressionPlan> = {
  neutral: {
    expressionNames: ["neutral", "default"],
    motionGroups: ["Idle"],
  },
  happy: {
    expressionNames: ["happy", "smile", "joy"],
    motionGroups: ["TapBody", "Happy", "Idle"],
  },
  sad: {
    expressionNames: ["sad", "troubled"],
    motionGroups: ["Sad", "Idle"],
  },
  angry: {
    expressionNames: ["angry", "mad"],
    motionGroups: ["Angry", "Idle"],
  },
  surprised: {
    expressionNames: ["surprised", "surprise"],
    motionGroups: ["Surprised", "Idle"],
  },
  relaxed: {
    expressionNames: ["relaxed", "soft", "default"],
    motionGroups: ["Idle"],
  },
};

export function getLive2DExpressionPlan(
  emotion: AvatarEmotion,
): Live2DExpressionPlan {
  return EMOTION_TO_LIVE2D[emotion] ?? EMOTION_TO_LIVE2D.neutral;
}
