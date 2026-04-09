"use client";

import { Settings } from "@/skills/settings/Settings";
import { AiChat } from "@/skills/ai-chat/AiChat";

interface SkillRendererProps {
  skillId: string;
  windowId: string;
}

export function SkillRenderer({ skillId, windowId }: SkillRendererProps) {
  switch (skillId) {
    case "settings":
      return <Settings />;
    case "ai-chat":
      return <AiChat />;
    case "file-manager":
      return <PlaceholderSkill name="文件管理器" description="文件管理功能将在阶段四实现" />;
    case "terminal":
      return <PlaceholderSkill name="终端" description="终端功能将在阶段四实现" />;
    case "browser":
      return <PlaceholderSkill name="浏览器" description="浏览器功能将在阶段五实现" />;
    case "notes":
      return <PlaceholderSkill name="笔记" description="笔记功能将在阶段四实现" />;
    case "calendar":
      return <PlaceholderSkill name="日历" description="日历功能将在阶段五实现" />;
    default:
      return <PlaceholderSkill name={skillId} description="未知 Skill" />;
  }
}

function PlaceholderSkill({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
      <h2 className="text-xl font-medium" style={{ color: "var(--t1)" }}>{name}</h2>
      <p className="text-sm" style={{ color: "var(--t2)" }}>{description}</p>
    </div>
  );
}
