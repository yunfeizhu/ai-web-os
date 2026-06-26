"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

// ── Loading placeholder ────────────────────────────────
function AppLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: "var(--border)", borderTopColor: "transparent" }}
      />
    </div>
  );
}

// ── 按需懒加载各 App（每个 App 独立 chunk，首次打开时才加载）
const AiChat = dynamic(
  () => import("@/apps/ai-chat/AiChat").then((m) => ({ default: m.AiChat })),
  { loading: AppLoading },
);
const Browser = dynamic(
  () => import("@/apps/browser/Browser").then((m) => ({ default: m.Browser })),
  { loading: AppLoading },
);
const CalendarApp = dynamic(
  () =>
    import("@/apps/calendar/CalendarApp").then((m) => ({
      default: m.CalendarApp,
    })),
  { loading: AppLoading },
);
const DocumentEditor = dynamic(
  () =>
    import("@/apps/document-editor/DocumentEditor").then((m) => ({
      default: m.DocumentEditor,
    })),
  { loading: AppLoading },
);
const FileManager = dynamic(
  () =>
    import("@/apps/file-manager/FileManager").then((m) => ({
      default: m.FileManager,
    })),
  { loading: AppLoading },
);
const MailApp = dynamic(
  () => import("@/apps/mail/MailApp").then((m) => ({ default: m.MailApp })),
  { loading: AppLoading },
);
const Notes = dynamic(
  () => import("@/apps/notes/Notes").then((m) => ({ default: m.Notes })),
  { loading: AppLoading },
);
const Settings = dynamic(
  () =>
    import("@/apps/settings/Settings").then((m) => ({ default: m.Settings })),
  { loading: AppLoading },
);
const SpreadsheetEditor = dynamic(
  () =>
    import("@/apps/spreadsheet-viewer/SpreadsheetEditor").then((m) => ({
      default: m.SpreadsheetEditor,
    })),
  { loading: AppLoading },
);
const Terminal = dynamic(
  () =>
    import("@/apps/terminal/Terminal").then((m) => ({ default: m.Terminal })),
  { loading: AppLoading },
);
const TextEditor = dynamic(
  () =>
    import("@/apps/text-editor/TextEditor").then((m) => ({
      default: m.TextEditor,
    })),
  { loading: AppLoading },
);
const WhiteboardApp = dynamic(
  () =>
    import("@/apps/whiteboard/WhiteboardApp").then((m) => ({
      default: m.WhiteboardApp,
    })),
  { loading: AppLoading },
);

interface AppRendererProps {
  appId: string;
  appState?: Record<string, unknown>;
  windowId: string;
}

export function AppRenderer({ appId, appState, windowId }: AppRendererProps) {
  switch (appId) {
    case "settings":
      return <Settings appState={appState} />;
    case "ai-chat":
      return withNativeAppTheme(<AiChat />);
    case "file-manager":
      return withNativeAppTheme(<FileManager appState={appState} />);
    case "terminal":
      return <Terminal windowId={windowId} />;
    case "browser":
      return withNativeAppTheme(
        <Browser appState={appState} windowId={windowId} />,
      );
    case "notes":
      return withNativeAppTheme(<Notes windowId={windowId} />);
    case "document-editor":
      return withNativeAppTheme(
        <DocumentEditor appState={appState} windowId={windowId} />,
      );
    case "text-editor":
      return withNativeAppTheme(
        <TextEditor appState={appState} windowId={windowId} />,
      );
    case "spreadsheet-viewer":
      return withNativeAppTheme(
        <SpreadsheetEditor appState={appState} windowId={windowId} />,
      );
    case "calendar":
      return withNativeAppTheme(<CalendarApp />);
    case "mail":
      return withNativeAppTheme(<MailApp appState={appState} />);
    case "whiteboard":
      return withNativeAppTheme(
        <WhiteboardApp appState={appState} windowId={windowId} />,
      );
    default:
      return <PlaceholderApp name={appId} description="应用暂未提供内容。" />;
  }
}

function withNativeAppTheme(children: ReactNode) {
  return <div className="macos-dark-app h-full min-w-0">{children}</div>;
}

function PlaceholderApp({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
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
