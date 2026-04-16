"use client";

import { AiChat } from "@/apps/ai-chat/AiChat";
import { Browser } from "@/apps/browser/Browser";
import { FileManager } from "@/apps/file-manager/FileManager";
import { Notes } from "@/apps/notes/Notes";
import { Settings } from "@/apps/settings/Settings";
import { SpreadsheetEditor } from "@/apps/spreadsheet-viewer/SpreadsheetEditor";
import { Terminal } from "@/apps/terminal/Terminal";
import { TextEditor } from "@/apps/text-editor/TextEditor";

interface AppRendererProps {
  appId: string;
  appState?: Record<string, unknown>;
  windowId: string;
}

export function AppRenderer({ appId, appState, windowId }: AppRendererProps) {
  switch (appId) {
    case "settings":
      return <Settings />;
    case "ai-chat":
      return <AiChat />;
    case "file-manager":
      return <FileManager />;
    case "terminal":
      return <Terminal windowId={windowId} />;
    case "browser":
      return <Browser appState={appState} windowId={windowId} />;
    case "notes":
      return <Notes />;
    case "text-editor":
      return <TextEditor appState={appState} windowId={windowId} />;
    case "spreadsheet-viewer":
      return <SpreadsheetEditor appState={appState} windowId={windowId} />;
    case "calendar":
      return <PlaceholderApp name="日历" description="日历功能正在开发中，敬请期待。" />;
    default:
      return <PlaceholderApp name={appId} description="应用暂未提供内容。" />;
  }
}

function PlaceholderApp({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      <h2 className="text-xl font-medium" style={{ color: "var(--t1)" }}>
        {name}
      </h2>
      <p className="text-sm" style={{ color: "var(--t2)" }}>
        {description}
      </p>
    </div>
  );
}
