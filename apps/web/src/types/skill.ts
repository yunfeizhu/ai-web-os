// Skill 类型定义

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  category: SkillCategory;
  agent: {
    systemPrompt: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  ui: {
    component: string;
    defaultSize: { width: number; height: number };
    minSize: { width: number; height: number };
    singleton: boolean;
  };
  mcp?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  requires?: string[];
  settings?: SkillSettingsSchema;
}

export type SkillCategory =
  | "productivity"
  | "communication"
  | "development"
  | "creative"
  | "utility"
  | "system";

export interface SkillSettingsSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "select";
    label: string;
    default: unknown;
    options?: string[];
    description?: string;
  };
}

export interface InstalledSkill {
  manifest: SkillManifest;
  status: "installed" | "active" | "disabled";
  isBuiltin: boolean;
  isPinned: boolean;
  settings: Record<string, unknown>;
}
