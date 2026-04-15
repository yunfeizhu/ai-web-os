"use client";

import { apiFetch } from "@/lib/backend";

const fileTextCache = new Map<string, Promise<string>>();

export function loadFileText(path: string) {
  const cached = fileTextCache.get(path);
  if (cached) {
    return cached;
  }

  const request = apiFetch<{ content: string }>(`/files/content?path=${encodeURIComponent(path)}`)
    .then((data) => data.content)
    .catch((error) => {
      fileTextCache.delete(path);
      throw error;
    });

  fileTextCache.set(path, request);
  return request;
}

export function invalidateFileTextCache(path?: string) {
  if (path) {
    fileTextCache.delete(path);
    return;
  }

  fileTextCache.clear();
}
