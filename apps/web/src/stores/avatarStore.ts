import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  AVATAR_DEFAULT_SIZE,
  AVATAR_FALLBACK_VIEWPORT,
  clampAvatarDockPlacement,
  getDefaultAvatarPlacement,
  type AvatarPosition,
  type AvatarSize,
  type ViewportSize,
} from "@/apps/avatar-pet/avatar-layout";
import type { AvatarEmotion } from "@/apps/avatar-pet/emotion-parser";

export type AvatarModelSourceType = "url" | "zip";

const LEGACY_PUBLIC_LIVE2D_PREFIX = "/avatar/live2d/";
const LOCAL_AVATAR_ASSET_PREFIX = "/avatar/assets/";

function normalizeAvatarModelUrl(modelUrl: string) {
  const trimmed = modelUrl.trim();

  if (trimmed.startsWith(LEGACY_PUBLIC_LIVE2D_PREFIX)) {
    return `${LOCAL_AVATAR_ASSET_PREFIX}live2d/${trimmed.slice(
      LEGACY_PUBLIC_LIVE2D_PREFIX.length,
    )}`;
  }

  return trimmed;
}

export interface AvatarState {
  visible: boolean;
  bubbleOpen: boolean;
  position: AvatarPosition;
  size: AvatarSize;
  modelSourceType: AvatarModelSourceType;
  modelUrl: string;
  localModelName: string;
  live2dError: string;
  currentEmotion: AvatarEmotion;
  personalityPreset: "default";

  setVisible: (visible: boolean) => void;
  setBubbleOpen: (bubbleOpen: boolean) => void;
  toggleBubble: () => void;
  setPosition: (position: AvatarPosition, viewport?: ViewportSize) => void;
  setSize: (size: AvatarSize, viewport?: ViewportSize) => void;
  normalizePlacement: (viewport?: ViewportSize) => void;
  resetPlacement: (viewport?: ViewportSize) => void;
  setModelUrl: (modelUrl: string) => void;
  setLocalModelName: (localModelName: string) => void;
  setModelSourceType: (modelSourceType: AvatarModelSourceType) => void;
  setLive2DError: (live2dError: string) => void;
  setCurrentEmotion: (currentEmotion: AvatarEmotion) => void;
}

export const useAvatarStore = create<AvatarState>()(
  persist(
    (set) => ({
      visible: true,
      bubbleOpen: false,
      position: getDefaultAvatarPlacement(AVATAR_FALLBACK_VIEWPORT),
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      live2dError: "",
      currentEmotion: "neutral",
      personalityPreset: "default",

      setVisible: (visible) => set({ visible }),
      setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
      toggleBubble: () => set((state) => ({ bubbleOpen: !state.bubbleOpen })),
      setPosition: (position, viewport) =>
        set((state) => ({
          position: viewport
            ? clampAvatarDockPlacement(position, state.size, viewport)
            : position,
        })),
      setSize: (size, viewport) =>
        set((state) => ({
          size,
          position: viewport
            ? clampAvatarDockPlacement(state.position, size, viewport)
            : state.position,
        })),
      normalizePlacement: (viewport) =>
        set((state) => ({
          position: clampAvatarDockPlacement(
            state.position,
            state.size,
            viewport,
          ),
        })),
      resetPlacement: (viewport) =>
        set({
          size: AVATAR_DEFAULT_SIZE,
          position: getDefaultAvatarPlacement(viewport, AVATAR_DEFAULT_SIZE),
        }),
      setModelUrl: (modelUrl) =>
        set({
          modelUrl: normalizeAvatarModelUrl(modelUrl),
          modelSourceType: "url",
          live2dError: "",
        }),
      setLocalModelName: (localModelName) =>
        set({ localModelName, modelSourceType: "zip", live2dError: "" }),
      setModelSourceType: (modelSourceType) =>
        set({ modelSourceType, live2dError: "" }),
      setLive2DError: (live2dError) => set({ live2dError }),
      setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
    }),
    {
      name: "ainative-avatar",
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Partial<AvatarState>;
        if (typeof state.modelUrl !== "string") {
          return state as AvatarState;
        }

        return {
          ...state,
          modelUrl: normalizeAvatarModelUrl(state.modelUrl),
        } as AvatarState;
      },
      partialize: (state) => ({
        visible: state.visible,
        bubbleOpen: state.bubbleOpen,
        position: state.position,
        size: state.size,
        modelSourceType: state.modelSourceType,
        modelUrl: state.modelUrl,
        localModelName: state.localModelName,
        currentEmotion: state.currentEmotion,
        personalityPreset: state.personalityPreset,
      }),
    },
  ),
);
