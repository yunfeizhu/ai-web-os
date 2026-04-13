// App 类型定义

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  category: AppCategory;
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
  settings?: AppSettingsSchema;
}

export type AppCategory =
  | "productivity"
  | "communication"
  | "development"
  | "creative"
  | "utility"
  | "system";

export interface AppSettingsSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "select";
    label: string;
    default: unknown;
    options?: string[];
    description?: string;
  };
}

export interface InstalledApp {
  manifest: AppManifest;
  status: "installed" | "active" | "disabled";
  isBuiltin: boolean;
  isPinned: boolean;
  settings: Record<string, unknown>;
}
