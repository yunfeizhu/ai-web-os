export const AVATAR_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "relaxed",
  "closed",
] as const;

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

export const AVATAR_MOTIONS = ["heart"] as const;

export type AvatarMotion = (typeof AVATAR_MOTIONS)[number];

export type ParsedAvatarEmotionText = {
  text: string;
  emotions: AvatarEmotion[];
  currentEmotion: AvatarEmotion;
};

export type ParsedAvatarCueText = ParsedAvatarEmotionText & {
  motions: AvatarMotion[];
};

const AVATAR_EMOTION_SET = new Set<string>(AVATAR_EMOTIONS);
const AVATAR_MOTION_SET = new Set<string>(AVATAR_MOTIONS);
const AVATAR_CUE_TAG_PATTERN = /\[\s*(emotion|motion)\s*:\s*([^\]]*)\]/gi;

function trimLeadingEmotionWhitespace(text: string): string {
  return text.replace(/^\s+/, "");
}

export function isAvatarEmotion(value: string): value is AvatarEmotion {
  return AVATAR_EMOTION_SET.has(value);
}

export function isAvatarMotion(value: string): value is AvatarMotion {
  return AVATAR_MOTION_SET.has(value);
}

export function stripAvatarCueTags(input: string): string {
  return trimLeadingEmotionWhitespace(input.replace(AVATAR_CUE_TAG_PATTERN, ""));
}

export function stripAvatarEmotionTags(input: string): string {
  return stripAvatarCueTags(input);
}

export function parseAvatarCues(input: string): ParsedAvatarCueText {
  const emotions: AvatarEmotion[] = [];
  const motions: AvatarMotion[] = [];

  const text = input.replace(
    AVATAR_CUE_TAG_PATTERN,
    (_match, rawKind: string, rawValue: string) => {
      const kind = rawKind.trim().toLowerCase();
      const value = rawValue.trim().toLowerCase();

      if (kind === "emotion" && isAvatarEmotion(value)) {
        emotions.push(value);
      }

      if (kind === "motion" && isAvatarMotion(value)) {
        motions.push(value);
      }

      return "";
    },
  );

  return {
    text: trimLeadingEmotionWhitespace(text),
    emotions,
    currentEmotion: emotions.at(-1) ?? "neutral",
    motions,
  };
}

export function parseAvatarEmotions(input: string): ParsedAvatarEmotionText {
  const { text, emotions, currentEmotion } = parseAvatarCues(input);

  return {
    text,
    emotions,
    currentEmotion,
  };
}
