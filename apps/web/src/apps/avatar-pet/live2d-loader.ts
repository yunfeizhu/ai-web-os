import JSZip, { type JSZipObject } from "jszip";
import { get, set } from "idb-keyval";

export type Live2DSourceKind = "missing" | "model3-json" | "zip" | "unknown";

export type Live2DSourceClassification = {
  kind: Live2DSourceKind;
  source: string;
};

export type PreparedZipModel = {
  objectUrl: string;
  modelSettingsPath: string;
  objectUrls: string[];
};

const MODEL3_JSON_EXTENSION = ".model3.json";
const MODEL_JSON_EXTENSION = ".model.json";
const ZIP_EXTENSION = ".zip";
const AVATAR_ZIP_CACHE_KEY = "ainative-avatar-live2d-zip";

function hasExtension(source: string, extension: string): boolean {
  const fragmentStart = source.search(/[?#]/);
  const sourcePath =
    fragmentStart === -1 ? source : source.slice(0, fragmentStart);

  return sourcePath.toLowerCase().endsWith(extension);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

function isExternalReference(value: string): boolean {
  return (
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    value.startsWith("#")
  );
}

function resolveZipReference(baseDirectory: string, reference: string): string {
  const normalizedReference = normalizePath(reference);
  const combinedPath = normalizedReference.startsWith("/")
    ? normalizedReference.slice(1)
    : [baseDirectory, normalizedReference].filter(Boolean).join("/");
  const parts: string[] = [];

  for (const part of combinedPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

async function rewriteZipReferences(
  value: unknown,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
): Promise<unknown> {
  if (typeof value === "string") {
    if (value.trim() === "" || isExternalReference(value)) {
      return value;
    }

    const assetPath = resolveZipReference(baseDirectory, value);
    const entry = entries.get(assetPath);

    if (!entry) {
      return value;
    }

    const existingObjectUrl = objectUrlByPath.get(assetPath);
    if (existingObjectUrl) {
      return existingObjectUrl;
    }

    const assetBlob = await entry.async("blob");
    const assetObjectUrl = URL.createObjectURL(assetBlob);
    objectUrlByPath.set(assetPath, assetObjectUrl);
    objectUrls.push(assetObjectUrl);

    return assetObjectUrl;
  }

  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) =>
        rewriteZipReferences(
          item,
          baseDirectory,
          entries,
          objectUrlByPath,
          objectUrls,
        ),
      ),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await rewriteZipReferences(
            item,
            baseDirectory,
            entries,
            objectUrlByPath,
            objectUrls,
          ),
        ]),
      ),
    );
  }

  return value;
}

export function isLive2DZipSource(source: string): boolean {
  return hasExtension(source.trim(), ZIP_EXTENSION);
}

export function classifyLive2DSource(
  source: string,
): Live2DSourceClassification {
  const trimmedSource = source.trim();

  if (trimmedSource.length === 0) {
    return { kind: "missing", source: trimmedSource };
  }

  if (hasExtension(trimmedSource, MODEL3_JSON_EXTENSION)) {
    return { kind: "model3-json", source: trimmedSource };
  }

  if (isLive2DZipSource(trimmedSource)) {
    return { kind: "zip", source: trimmedSource };
  }

  return { kind: "unknown", source: trimmedSource };
}

export function findModelSettingsPath(paths: string[]): string | null {
  const normalizedPaths = paths.map(normalizePath);

  return (
    normalizedPaths.find((path) => hasExtension(path, MODEL3_JSON_EXTENSION)) ??
    normalizedPaths.find((path) => hasExtension(path, MODEL_JSON_EXTENSION)) ??
    null
  );
}

export async function prepareZipModelBlob(blob: Blob): Promise<PreparedZipModel> {
  const zip = await JSZip.loadAsync(blob);
  const entries = new Map<string, JSZipObject>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    entries.set(normalizePath(path), entry);
  }

  const modelSettingsPath = findModelSettingsPath([...entries.keys()]);

  if (!modelSettingsPath) {
    throw new Error("No Live2D model settings file found in ZIP");
  }

  const modelSettingsEntry = entries.get(modelSettingsPath);
  if (!modelSettingsEntry) {
    throw new Error(`Live2D model settings file could not be read: ${modelSettingsPath}`);
  }

  const modelSettings = JSON.parse(await modelSettingsEntry.async("text")) as unknown;
  const baseDirectory = dirname(modelSettingsPath);
  const objectUrls: string[] = [];
  const objectUrlByPath = new Map<string, string>();

  const rewrittenSettings = await rewriteZipReferences(
    modelSettings,
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
  const rewrittenSettingsBlob = new Blob([JSON.stringify(rewrittenSettings)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(rewrittenSettingsBlob);

  objectUrls.push(objectUrl);

  return {
    objectUrl,
    modelSettingsPath,
    objectUrls,
  };
}

export async function saveAvatarZip(file: File): Promise<void> {
  await set(AVATAR_ZIP_CACHE_KEY, file);
}

export async function loadAvatarZip(): Promise<File | null> {
  const cached = await get<unknown>(AVATAR_ZIP_CACHE_KEY);

  if (!cached) {
    return null;
  }

  if (cached instanceof File) {
    return cached;
  }

  if (cached instanceof Blob) {
    return new File([cached], "avatar-live2d.zip", {
      type: cached.type || "application/zip",
    });
  }

  return null;
}
