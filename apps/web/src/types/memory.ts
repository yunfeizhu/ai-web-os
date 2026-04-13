// Memory 类型定义

export interface MemoryEntry {
  id: string;
  type: "user" | "agent" | "fact";
  content: string;
  sourceApp: string;
  createdAt: string;
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  total: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  byApp: Record<string, number>;
}
