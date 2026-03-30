"use client";

import { useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { Window } from "./Window";
import { SkillRenderer } from "@/skills/SkillRenderer";
import { WindowSnapZoneOverlay, type SnapZone } from "./WindowSnapZone";

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZone>(null);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <WindowSnapZoneOverlay activeZone={activeSnapZone} />
      {Object.values(windows).map((win) => (
        <Window
          key={win.id}
          window={win}
          onSnapZoneChange={setActiveSnapZone}
        >
          <SkillRenderer skillId={win.skillId} windowId={win.id} />
        </Window>
      ))}
    </div>
  );
}
