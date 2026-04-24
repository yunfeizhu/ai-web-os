"use client";

import { useEffect, useRef } from "react";
import { Bot, MessageCircle, X } from "lucide-react";
import { Rnd } from "react-rnd";

import {
  AVATAR_CLAMP_GAP,
  AVATAR_MAX_SIZE,
  AVATAR_MIN_SIZE,
  clampAvatarDockPlacement,
  type AvatarPosition,
  type AvatarSize,
  type ViewportSize,
} from "@/apps/avatar-pet/avatar-layout";
import { useAvatarStore } from "@/stores/avatarStore";

const BUBBLE_WIDTH_ESTIMATE = 240;
const BUBBLE_HEIGHT_ESTIMATE = 76;
const BUBBLE_OFFSET = 8;

function getViewport(): ViewportSize {
  if (typeof window === "undefined") {
    return {
      width: 1440,
      height: 900,
    };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function AvatarPet() {
  const visible = useAvatarStore((state) => state.visible);
  const bubbleOpen = useAvatarStore((state) => state.bubbleOpen);
  const position = useAvatarStore((state) => state.position);
  const size = useAvatarStore((state) => state.size);
  const setVisible = useAvatarStore((state) => state.setVisible);
  const setBubbleOpen = useAvatarStore((state) => state.setBubbleOpen);
  const toggleBubble = useAvatarStore((state) => state.toggleBubble);
  const setPosition = useAvatarStore((state) => state.setPosition);
  const setSize = useAvatarStore((state) => state.setSize);
  const normalizePlacement = useAvatarStore((state) => state.normalizePlacement);
  const dragGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPositionRef = useRef<AvatarPosition | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    const normalize = () => normalizePlacement(getViewport());

    normalize();
    window.addEventListener("resize", normalize);
    return () => {
      window.removeEventListener("resize", normalize);
      if (dragGuardRef.current) {
        clearTimeout(dragGuardRef.current);
      }
    };
  }, [normalizePlacement]);

  if (!visible) return null;

  const armDragGuard = () => {
    draggedRef.current = true;
    if (dragGuardRef.current) {
      clearTimeout(dragGuardRef.current);
    }
    dragGuardRef.current = setTimeout(() => {
      draggedRef.current = false;
      dragGuardRef.current = null;
    }, 180);
  };

  const handleAvatarClick = () => {
    if (draggedRef.current) return;
    toggleBubble();
  };

  const handleClose = () => {
    setBubbleOpen(false);
    setVisible(false);
  };

  const viewport = getViewport();
  const showBubbleBelow = position.y < BUBBLE_HEIGHT_ESTIMATE + BUBBLE_OFFSET;
  const alignBubbleRight =
    position.x + BUBBLE_OFFSET + BUBBLE_WIDTH_ESTIMATE >
    viewport.width - AVATAR_CLAMP_GAP;

  return (
    <Rnd
      data-desktop-blocker="true"
      bounds="window"
      cancel="[data-avatar-control='true']"
      minWidth={AVATAR_MIN_SIZE.width}
      minHeight={AVATAR_MIN_SIZE.height}
      maxWidth={AVATAR_MAX_SIZE.width}
      maxHeight={AVATAR_MAX_SIZE.height}
      position={position}
      size={size}
      style={{ zIndex: 9000 }}
      onDragStart={(_event, data) => {
        dragStartPositionRef.current = { x: data.x, y: data.y };
      }}
      onDragStop={(_event, data) => {
        const startPosition = dragStartPositionRef.current;
        dragStartPositionRef.current = null;
        if (
          startPosition &&
          (startPosition.x !== data.x || startPosition.y !== data.y)
        ) {
          armDragGuard();
        }
        setPosition({ x: data.x, y: data.y }, getViewport());
      }}
      onResizeStop={(_event, _direction, ref, _delta, nextPosition) => {
        const viewport = getViewport();
        const nextSize: AvatarSize = {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        };
        const clampedPosition: AvatarPosition = clampAvatarDockPlacement(
          nextPosition,
          nextSize,
          viewport,
        );

        armDragGuard();
        setSize(nextSize, viewport);
        setPosition(clampedPosition, viewport);
      }}
    >
      <div className="relative flex h-full w-full select-none flex-col overflow-visible">
        {bubbleOpen && (
          <div
            className={`absolute z-10 max-w-[min(240px,calc(100vw-32px))] rounded-lg px-3 py-2 text-[13px] leading-5 shadow-lg ${
              alignBubbleRight ? "right-2" : "left-2"
            }`}
            style={{
              ...(showBubbleBelow
                ? { top: `calc(100% + ${BUBBLE_OFFSET}px)` }
                : { bottom: `calc(100% + ${BUBBLE_OFFSET}px)` }),
              color: "rgba(24,24,27,0.88)",
              background: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(255,255,255,0.62)",
              backdropFilter: "blur(24px) saturate(170%)",
              WebkitBackdropFilter: "blur(24px) saturate(170%)",
              boxShadow:
                "0 14px 34px rgba(15,23,42,0.18), 0 1px 0 rgba(255,255,255,0.75) inset",
            }}
          >
            我在这里，需要时叫我。
          </div>
        )}

        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-xl"
          style={{
            background: "rgba(247,248,250,0.52)",
            border: "1px solid rgba(255,255,255,0.5)",
            boxShadow:
              "0 18px 50px rgba(15,23,42,0.2), 0 1px 0 rgba(255,255,255,0.72) inset",
            backdropFilter: "blur(30px) saturate(175%)",
            WebkitBackdropFilter: "blur(30px) saturate(175%)",
          }}
        >
          <div className="flex items-center justify-between px-2.5 py-2">
            <button
              type="button"
              onClick={handleAvatarClick}
              data-avatar-control="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/55 active:bg-white/70"
              title="打开小月消息"
              aria-label="打开小月消息"
            >
              <MessageCircle size={17} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              data-avatar-control="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/55 active:bg-white/70"
              title="关闭小月"
              aria-label="关闭小月"
            >
              <X size={17} strokeWidth={1.9} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAvatarClick}
            className="flex min-h-0 flex-1 items-center justify-center p-3"
            title="小月"
            aria-label="小月"
          >
            <span
              className="flex h-full w-full items-center justify-center rounded-lg"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(226,232,240,0.52))",
                border: "1px solid rgba(255,255,255,0.55)",
                color: "rgba(30,41,59,0.72)",
              }}
            >
              <Bot
                size={Math.max(48, Math.min(size.width, size.height) * 0.32)}
                strokeWidth={1.35}
              />
            </span>
          </button>
        </div>
      </div>
    </Rnd>
  );
}
