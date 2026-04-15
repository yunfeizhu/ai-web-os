"use client";

const FILE_API_BASE = "http://localhost:8000/api/v1/files";

const fileBufferCache = new Map<string, Promise<ArrayBuffer>>();

export function downloadFileBuffer(fileId: string) {
  const cached = fileBufferCache.get(fileId);
  if (cached) {
    return cached.then(cloneArrayBuffer);
  }

  const request = fetch(`${FILE_API_BASE}/${fileId}/download`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.arrayBuffer();
    })
    .catch((error) => {
      fileBufferCache.delete(fileId);
      throw error;
    });

  fileBufferCache.set(fileId, request);

  return request.then(cloneArrayBuffer);
}

export function invalidateFileBufferCache(fileId?: string) {
  if (fileId) {
    fileBufferCache.delete(fileId);
    return;
  }

  fileBufferCache.clear();
}

function cloneArrayBuffer(buffer: ArrayBuffer) {
  return buffer.slice(0);
}
