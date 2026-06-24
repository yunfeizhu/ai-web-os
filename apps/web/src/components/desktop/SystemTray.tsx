"use client";

import { useEffect, useState } from "react";
import { DOCK_BASE_ICON_SIZE } from "./dockMagnification";

export function SystemTray() {
  const [time, setTime] = useState({ h: "", m: "" });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime({
        h: now.getHours().toString().padStart(2, "0"),
        m: now.getMinutes().toString().padStart(2, "0"),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-center justify-center px-1.5"
      style={{ height: DOCK_BASE_ICON_SIZE }}
    >
      <span
        className="text-[14px] font-semibold tabular-nums"
        style={{
          color: "rgba(0,0,0,0.55)",
          fontFamily: "var(--font-mono)",
          lineHeight: 1,
        }}
      >
        {time.h}:{time.m}
      </span>
    </div>
  );
}
