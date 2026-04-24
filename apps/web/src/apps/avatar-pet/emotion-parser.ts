export const AVATAR_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "relaxed",
] as const;

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

export type ParsedAvatarEmotionText = {
  text: string;
  emotions: AvatarEmotion[];
  currentEmotion: AvatarEmotion;
};

const AVATAR_EMOTION_SET = new Set<string>(AVATAR_EMOTIONS);
const EMOTION_TAG_PATTERN = /\[emotion:([^\]]+)\]/gi;

export function isAvatarEmotion(value: string): value is AvatarEmotion {
  return AVATAR_EMOTION_SET.has(value);
}

export function stripAvatarEmotionTags(input: string): string {
  return input.replace(EMOTION_TAG_PATTERN, "");
}

export function parseAvatarEmotions(input: string): ParsedAvatarEmotionText {
  const emotions: AvatarEmotion[] = [];

  const text = input.replace(EMOTION_TAG_PATTERN, (_match, rawEmotion: string) => {
    const emotion = rawEmotion.toLowerCase();

    if (isAvatarEmotion(emotion)) {
      emotions.push(emotion);
    }

    return "";
  });

  return {
    text,
    emotions,
    currentEmotion: emotions.at(-1) ?? "neutral",
  };
}
