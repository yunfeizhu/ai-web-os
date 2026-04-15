"use client";

import { useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { Window } from "./Window";
import { AppRenderer } from "@/apps/AppRenderer";
import { WindowSnapZoneOverlay, type SnapZone } from "./WindowSnapZone";

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZone>(null);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <WindowSnapZoneOverlay activeZone={activeSnapZone} />
      {Object.values(windows).map((win) => (
        <Window
          key={win.id}
          window={win}
          onSnapZoneChange={setActiveSnapZone}
        >
          <AppRenderer appId={win.appId} appState={win.appState} windowId={win.id} />
        </Window>
      ))}
    </div>
  );
}
