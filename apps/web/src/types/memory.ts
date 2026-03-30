// Memory 类型定义

export interface MemoryEntry {
  id: string;
  type: "user" | "agent" | "fact";
  content: string;
  sourceSkill: string;
  createdAt: string;
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  total: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  bySkill: Record<string, number>;
}
