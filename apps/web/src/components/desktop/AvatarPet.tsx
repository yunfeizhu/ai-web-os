"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
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
import { AvatarBubble } from "./AvatarBubble";

const BUBBLE_WIDTH_ESTIMATE = 320;
const BUBBLE_HEIGHT_ESTIMATE = 360;
const BUBBLE_OFFSET = 8;
const BUBBLE_MIN_HEIGHT = 160;
const CONTROL_CLICK_MOVE_THRESHOLD = 4;

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
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const dragGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPositionRef = useRef<AvatarPosition | null>(null);
  const controlPointerDownRef = useRef<AvatarPosition | null>(null);
  const suppressControlClickRef = useRef(false);
  const draggedRef = useRef(false);

  useEffect(() => {
    const updateViewport = () => {
      const nextViewport = getViewport();
      setViewport(nextViewport);
      normalizePlacement(nextViewport);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
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

  const handleControlPointerDown = (event: PointerEvent) => {
    controlPointerDownRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    suppressControlClickRef.current = false;
  };

  const handleControlPointerMove = (event: PointerEvent) => {
    const pointerDown = controlPointerDownRef.current;
    if (!pointerDown) return;

    const deltaX = event.clientX - pointerDown.x;
    const deltaY = event.clientY - pointerDown.y;
    if (Math.hypot(deltaX, deltaY) > CONTROL_CLICK_MOVE_THRESHOLD) {
      suppressControlClickRef.current = true;
    }
  };

  const handleControlPointerEnd = (event: PointerEvent) => {
    const pointerDown = controlPointerDownRef.current;
    if (pointerDown) {
      const deltaX = event.clientX - pointerDown.x;
      const deltaY = event.clientY - pointerDown.y;
      if (Math.hypot(deltaX, deltaY) > CONTROL_CLICK_MOVE_THRESHOLD) {
        suppressControlClickRef.current = true;
      }
    }

    controlPointerDownRef.current = null;
  };

  const shouldSuppressControlClick = (event: MouseEvent) => {
    const pointerDown = controlPointerDownRef.current;
    if (pointerDown) {
      const deltaX = event.clientX - pointerDown.x;
      const deltaY = event.clientY - pointerDown.y;
      if (Math.hypot(deltaX, deltaY) > CONTROL_CLICK_MOVE_THRESHOLD) {
        suppressControlClickRef.current = true;
      }
    }

    if (!suppressControlClickRef.current) return false;

    event.preventDefault();
    event.stopPropagation();
    suppressControlClickRef.current = false;
    controlPointerDownRef.current = null;
    return true;
  };

  const handleMessageClick = (event: MouseEvent) => {
    if (shouldSuppressControlClick(event)) return;
    handleAvatarClick();
  };

  const handleClose = () => {
    setBubbleOpen(false);
    setVisible(false);
  };

  const availableAbove =
    viewport === null
      ? BUBBLE_HEIGHT_ESTIMATE
      : Math.max(0, position.y - AVATAR_CLAMP_GAP - BUBBLE_OFFSET);
  const availableBelow =
    viewport === null
      ? 0
      : Math.max(
          0,
          viewport.height -
            (position.y + size.height) -
            AVATAR_CLAMP_GAP -
            BUBBLE_OFFSET,
        );
  const showBubbleBelow =
    availableBelow >= BUBBLE_MIN_HEIGHT || availableBelow > availableAbove;
  const selectedBubbleSpace = showBubbleBelow
    ? availableBelow
    : availableAbove;
  const useViewportAnchoredBubble =
    viewport !== null && selectedBubbleSpace < BUBBLE_MIN_HEIGHT;
  const bubbleMaxHeight = useViewportAnchoredBubble
    ? Math.max(96, viewport.height - AVATAR_CLAMP_GAP * 2)
    : Math.max(
        96,
        Math.min(BUBBLE_HEIGHT_ESTIMATE, selectedBubbleSpace),
      );
  const bubblePlacementStyle = useViewportAnchoredBubble
    ? { top: `${AVATAR_CLAMP_GAP - position.y}px` }
    : {
        ...(showBubbleBelow
          ? { top: `calc(100% + ${BUBBLE_OFFSET}px)` }
          : { bottom: `calc(100% + ${BUBBLE_OFFSET}px)` }),
      };
  const alignBubbleRight =
    viewport !== null &&
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
            className={`absolute z-10 ${
              alignBubbleRight ? "right-2" : "left-2"
            }`}
            style={bubblePlacementStyle}
          >
            <AvatarBubble maxHeight={bubbleMaxHeight} />
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
              onPointerDown={handleControlPointerDown}
              onPointerMove={handleControlPointerMove}
              onPointerUp={handleControlPointerEnd}
              onPointerCancel={handleControlPointerEnd}
              onClick={handleMessageClick}
              data-avatar-control="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/55 active:bg-white/70"
              title="打开虚拟伙伴消息"
              aria-label="打开虚拟伙伴消息"
            >
              <MessageCircle size={17} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onPointerDown={handleControlPointerDown}
              onPointerMove={handleControlPointerMove}
              onPointerUp={handleControlPointerEnd}
              onPointerCancel={handleControlPointerEnd}
              onClick={(event) => {
                if (shouldSuppressControlClick(event)) return;
                handleClose();
              }}
              data-avatar-control="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/55 active:bg-white/70"
              title="关闭虚拟伙伴"
              aria-label="关闭虚拟伙伴"
            >
              <X size={17} strokeWidth={1.9} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAvatarClick}
            className="flex min-h-0 flex-1 items-center justify-center p-3"
            title="虚拟伙伴"
            aria-label="虚拟伙伴"
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
