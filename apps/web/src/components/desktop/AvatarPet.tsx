"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { MessageCircle, X } from "lucide-react";
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
import { Live2DCanvas } from "./Live2DCanvas";

const BUBBLE_PANEL_WIDTH = 480;
const BUBBLE_PANEL_HEIGHT = 460;
const BUBBLE_SIDE_OFFSET = 18;
const BUBBLE_VIEWPORT_GAP = 16;
const BUBBLE_MIN_WIDTH = 280;
const BUBBLE_MIN_VIEWPORT_HEIGHT = 220;
const AVATAR_DIALOG_ANCHOR_RATIO = 0.65;
const AVATAR_PET_Z_INDEX = 10000;
const CONTROL_CLICK_MOVE_THRESHOLD = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
  const modelUrl = useAvatarStore((state) => state.modelUrl);
  const currentEmotion = useAvatarStore((state) => state.currentEmotion);
  const motionRequest = useAvatarStore((state) => state.motionRequest);
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
    toggleBubble();
  };

  const handleClose = () => {
    setBubbleOpen(false);
    setVisible(false);
  };

  const bubbleWidth =
    viewport === null
      ? BUBBLE_PANEL_WIDTH
      : Math.min(
          BUBBLE_PANEL_WIDTH,
          Math.max(BUBBLE_MIN_WIDTH, viewport.width - BUBBLE_VIEWPORT_GAP * 2),
        );
  const bubbleHeight =
    viewport === null
      ? BUBBLE_PANEL_HEIGHT
      : Math.min(
          BUBBLE_PANEL_HEIGHT,
          Math.max(
            BUBBLE_MIN_VIEWPORT_HEIGHT,
            viewport.height - BUBBLE_VIEWPORT_GAP * 2,
          ),
        );
  const preferredBubbleTop =
    position.y + size.height * AVATAR_DIALOG_ANCHOR_RATIO - bubbleHeight / 2;
  const maxBubbleTop =
    viewport === null
      ? preferredBubbleTop
      : Math.max(
          BUBBLE_VIEWPORT_GAP,
          viewport.height - BUBBLE_VIEWPORT_GAP - bubbleHeight,
        );
  const bubbleTop =
    viewport === null
      ? Math.round(size.height * AVATAR_DIALOG_ANCHOR_RATIO - bubbleHeight / 2)
      : Math.round(
          clamp(preferredBubbleTop, BUBBLE_VIEWPORT_GAP, maxBubbleTop) -
            position.y,
        );
  const availableRight =
    viewport === null
      ? Number.POSITIVE_INFINITY
      : viewport.width -
        (position.x + size.width) -
        BUBBLE_SIDE_OFFSET -
        BUBBLE_VIEWPORT_GAP;
  const availableLeft =
    viewport === null
      ? 0
      : position.x - BUBBLE_SIDE_OFFSET - BUBBLE_VIEWPORT_GAP;
  const canPlaceRight = availableRight >= bubbleWidth;
  const canPlaceLeft = availableLeft >= bubbleWidth;
  let bubblePlacement: "right" | "left" | "viewport" = "right";
  const bubblePlacementStyle: CSSProperties = {
    top: `${bubbleTop}px`,
  };

  if (canPlaceRight || viewport === null) {
    bubblePlacementStyle.left = `calc(100% + ${BUBBLE_SIDE_OFFSET}px)`;
  } else if (canPlaceLeft) {
    bubblePlacement = "left";
    bubblePlacementStyle.right = `calc(100% + ${BUBBLE_SIDE_OFFSET}px)`;
  } else {
    bubblePlacement = "viewport";
    const preferredViewportLeft =
      availableRight >= availableLeft
        ? position.x + size.width + BUBBLE_SIDE_OFFSET
        : position.x - bubbleWidth - BUBBLE_SIDE_OFFSET;
    const maxViewportLeft = Math.max(
      BUBBLE_VIEWPORT_GAP,
      (viewport?.width ?? BUBBLE_PANEL_WIDTH) - BUBBLE_VIEWPORT_GAP - bubbleWidth,
    );
    const viewportLeft = clamp(
      preferredViewportLeft,
      BUBBLE_VIEWPORT_GAP,
      maxViewportLeft,
    );
    bubblePlacementStyle.left = `${Math.round(viewportLeft - position.x)}px`;
  }

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
      style={{ zIndex: AVATAR_PET_Z_INDEX }}
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
            data-testid="avatar-pet-bubble-popover"
            data-avatar-bubble-placement={bubblePlacement}
            className="absolute z-20"
            style={bubblePlacementStyle}
          >
            <AvatarBubble maxHeight={bubbleHeight} width={bubbleWidth} />
          </div>
        )}

        <div
          data-testid="avatar-pet-shell"
          className="group relative flex h-full w-full flex-col overflow-hidden"
          style={{
            background: "transparent",
            border: "0 solid transparent",
            boxShadow: "none",
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
          }}
        >
          <div
            data-testid="avatar-pet-drag-frame"
            className="pointer-events-none absolute inset-0 z-[1] rounded-lg border border-white/55 opacity-0 shadow-[0_0_0_1px_rgba(15,23,42,0.16),0_0_18px_rgba(15,23,42,0.18)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            style={{ background: "transparent" }}
            aria-hidden="true"
          >
            <span className="absolute left-0 top-0 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-white/90 shadow-[0_0_8px_rgba(15,23,42,0.24)]" />
            <span className="absolute right-0 top-0 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-white/90 shadow-[0_0_8px_rgba(15,23,42,0.24)]" />
            <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-white/90 shadow-[0_0_8px_rgba(15,23,42,0.24)]" />
            <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-white/90 shadow-[0_0_8px_rgba(15,23,42,0.24)]" />
          </div>
          <div
            data-testid="avatar-pet-controls"
            className="pointer-events-none absolute inset-x-0 top-2 z-10 flex items-center justify-between px-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <button
              type="button"
              onPointerDown={handleControlPointerDown}
              onPointerMove={handleControlPointerMove}
              onPointerUp={handleControlPointerEnd}
              onPointerCancel={handleControlPointerEnd}
              onClick={handleMessageClick}
              data-avatar-control="true"
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-black/55 active:bg-black/70"
              style={{
                background: "rgba(15,23,42,0.38)",
                boxShadow: "0 6px 18px rgba(15,23,42,0.18)",
              }}
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
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-black/55 active:bg-black/70"
              style={{
                background: "rgba(15,23,42,0.38)",
                boxShadow: "0 6px 18px rgba(15,23,42,0.18)",
              }}
              title="关闭虚拟伙伴"
              aria-label="关闭虚拟伙伴"
            >
              <X size={17} strokeWidth={1.9} />
            </button>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center"
            title="虚拟伙伴"
          >
            <div
              data-testid="avatar-pet-stage"
              className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg"
              style={{
                background: "transparent",
                border: "0 solid transparent",
              }}
            >
              <Live2DCanvas
                modelUrl={modelUrl}
                emotion={currentEmotion}
                motionRequest={motionRequest}
              />
            </div>
          </div>
        </div>
      </div>
    </Rnd>
  );
}
