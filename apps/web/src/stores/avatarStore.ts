import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  AVATAR_DEFAULT_SIZE,
  getDefaultAvatarPlacement,
  type AvatarPosition,
  type AvatarSize,
  type ViewportSize,
} from "@/apps/avatar-pet/avatar-layout";
import type { AvatarEmotion } from "@/apps/avatar-pet/emotion-parser";

export type AvatarModelSourceType = "url" | "zip";

export interface AvatarState {
  visible: boolean;
  bubbleOpen: boolean;
  position: AvatarPosition;
  size: AvatarSize;
  modelSourceType: AvatarModelSourceType;
  modelUrl: string;
  localModelName: string;
  currentEmotion: AvatarEmotion;
  personalityPreset: "default";

  setVisible: (visible: boolean) => void;
  setBubbleOpen: (bubbleOpen: boolean) => void;
  toggleBubble: () => void;
  setPosition: (position: AvatarPosition) => void;
  setSize: (size: AvatarSize) => void;
  resetPlacement: (viewport?: ViewportSize) => void;
  setModelUrl: (modelUrl: string) => void;
  setLocalModelName: (localModelName: string) => void;
  setModelSourceType: (modelSourceType: AvatarModelSourceType) => void;
  setCurrentEmotion: (currentEmotion: AvatarEmotion) => void;
}

export const useAvatarStore = create<AvatarState>()(
  persist(
    (set, get) => ({
      visible: true,
      bubbleOpen: false,
      position: getDefaultAvatarPlacement(),
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",

      setVisible: (visible) => set({ visible }),
      setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
      toggleBubble: () => set((state) => ({ bubbleOpen: !state.bubbleOpen })),
      setPosition: (position) => set({ position }),
      setSize: (size) => set({ size }),
      resetPlacement: (viewport) =>
        set((state) => ({
          position: getDefaultAvatarPlacement(viewport, state.size),
        })),
      setModelUrl: (modelUrl) => set({ modelUrl, modelSourceType: "url" }),
      setLocalModelName: (localModelName) =>
        set({ localModelName, modelSourceType: "zip" }),
      setModelSourceType: (modelSourceType) => set({ modelSourceType }),
      setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
    }),
    {
      name: "ainative-avatar",
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
