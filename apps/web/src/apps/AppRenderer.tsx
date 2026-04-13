"use client";

import { AiChat } from "@/apps/ai-chat/AiChat";
import { Settings } from "@/apps/settings/Settings";

interface AppRendererProps {
  appId: string;
}

export function AppRenderer({ appId }: AppRendererProps) {
  switch (appId) {
    case "settings":
      return <Settings />;
    case "ai-chat":
      return <AiChat />;
    case "file-manager":
      return <PlaceholderApp name="文件管理器" description="文件管理功能正在开发中，敬请期待。" />;
    case "terminal":
      return <PlaceholderApp name="终端" description="终端功能正在开发中，敬请期待。" />;
    case "browser":
      return <PlaceholderApp name="浏览器" description="浏览器功能正在开发中，敬请期待。" />;
    case "notes":
      return <PlaceholderApp name="笔记" description="笔记功能正在开发中，敬请期待。" />;
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
