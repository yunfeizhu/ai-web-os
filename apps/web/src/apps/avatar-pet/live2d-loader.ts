import JSZip, { type JSZipObject } from "jszip";

import { buildApiUrl } from "@/lib/backend";

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

export type StoredAvatarZip = {
  name: string;
  path: string;
  url: string;
};

const MODEL3_JSON_EXTENSION = ".model3.json";
const MODEL_JSON_EXTENSION = ".model.json";
const ZIP_EXTENSION = ".zip";
const LEGACY_PUBLIC_LIVE2D_PREFIX = "/avatar/live2d/";
const LOCAL_AVATAR_ASSET_PREFIX = "/avatar/assets/";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

async function createAssetObjectUrl(
  reference: string,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
): Promise<string> {
  if (reference.trim() === "" || isExternalReference(reference)) {
    return reference;
  }

  const assetPath = resolveZipReference(baseDirectory, reference);
  const entry = entries.get(assetPath);

  if (!entry) {
    return reference;
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

async function rewriteStringProperty(
  object: Record<string, unknown>,
  key: string,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
) {
  const value = object[key];

  if (typeof value !== "string") {
    return;
  }

  object[key] = await createAssetObjectUrl(
    value,
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
}

async function rewriteStringArrayProperty(
  object: Record<string, unknown>,
  key: string,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
) {
  const value = object[key];

  if (!Array.isArray(value)) {
    return;
  }

  const rewrittenItems: unknown[] = [];

  for (const item of value) {
    rewrittenItems.push(
      typeof item === "string"
        ? await createAssetObjectUrl(
            item,
            baseDirectory,
            entries,
            objectUrlByPath,
            objectUrls,
          )
        : item,
    );
  }

  object[key] = rewrittenItems;
}

async function rewriteModel3FileReferences(
  fileReferences: Record<string, unknown>,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
) {
  await rewriteStringProperty(
    fileReferences,
    "Moc",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
  await rewriteStringArrayProperty(
    fileReferences,
    "Textures",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );

  for (const key of ["Physics", "Pose", "DisplayInfo", "UserData"]) {
    await rewriteStringProperty(
      fileReferences,
      key,
      baseDirectory,
      entries,
      objectUrlByPath,
      objectUrls,
    );
  }

  if (Array.isArray(fileReferences.Expressions)) {
    for (const expression of fileReferences.Expressions) {
      if (!isPlainObject(expression)) continue;

      await rewriteStringProperty(
        expression,
        "File",
        baseDirectory,
        entries,
        objectUrlByPath,
        objectUrls,
      );
    }
  }

  if (isPlainObject(fileReferences.Motions)) {
    for (const motions of Object.values(fileReferences.Motions)) {
      if (!Array.isArray(motions)) continue;

      for (const motion of motions) {
        if (!isPlainObject(motion)) continue;

        await rewriteStringProperty(
          motion,
          "File",
          baseDirectory,
          entries,
          objectUrlByPath,
          objectUrls,
        );
        await rewriteStringProperty(
          motion,
          "Sound",
          baseDirectory,
          entries,
          objectUrlByPath,
          objectUrls,
        );
      }
    }
  }
}

async function rewriteCubism2FileReferences(
  modelSettings: Record<string, unknown>,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
) {
  await rewriteStringProperty(
    modelSettings,
    "model",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
  await rewriteStringArrayProperty(
    modelSettings,
    "textures",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
  await rewriteStringProperty(
    modelSettings,
    "physics",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );
  await rewriteStringProperty(
    modelSettings,
    "pose",
    baseDirectory,
    entries,
    objectUrlByPath,
    objectUrls,
  );

  if (Array.isArray(modelSettings.expressions)) {
    for (const expression of modelSettings.expressions) {
      if (!isPlainObject(expression)) continue;

      await rewriteStringProperty(
        expression,
        "file",
        baseDirectory,
        entries,
        objectUrlByPath,
        objectUrls,
      );
    }
  }

  if (isPlainObject(modelSettings.motions)) {
    for (const motions of Object.values(modelSettings.motions)) {
      if (!Array.isArray(motions)) continue;

      for (const motion of motions) {
        if (!isPlainObject(motion)) continue;

        await rewriteStringProperty(
          motion,
          "file",
          baseDirectory,
          entries,
          objectUrlByPath,
          objectUrls,
        );
        await rewriteStringProperty(
          motion,
          "sound",
          baseDirectory,
          entries,
          objectUrlByPath,
          objectUrls,
        );
      }
    }
  }
}

async function rewriteFileReferences(
  modelSettings: unknown,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
): Promise<unknown> {
  if (!isPlainObject(modelSettings)) {
    return modelSettings;
  }

  const rewrittenSettings = structuredClone(modelSettings);

  if (isPlainObject(rewrittenSettings.FileReferences)) {
    await rewriteModel3FileReferences(
      rewrittenSettings.FileReferences,
      baseDirectory,
      entries,
      objectUrlByPath,
      objectUrls,
    );
  } else {
    await rewriteCubism2FileReferences(
      rewrittenSettings,
      baseDirectory,
      entries,
      objectUrlByPath,
      objectUrls,
    );
  }

  return rewrittenSettings;
}

function revokeObjectUrls(objectUrls: string[]) {
  for (const objectUrl of objectUrls) {
    URL.revokeObjectURL(objectUrl);
  }
}

export function isLive2DZipSource(source: string): boolean {
  return hasExtension(source.trim(), ZIP_EXTENSION);
}

export function classifyLive2DSource(
  source: string,
): Live2DSourceClassification {
  const trimmedSource = normalizeAvatarModelSource(source);

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

export function normalizeAvatarModelSource(source: string): string {
  const trimmedSource = source.trim();

  if (trimmedSource.startsWith(LEGACY_PUBLIC_LIVE2D_PREFIX)) {
    return `${LOCAL_AVATAR_ASSET_PREFIX}live2d/${trimmedSource.slice(
      LEGACY_PUBLIC_LIVE2D_PREFIX.length,
    )}`;
  }

  return trimmedSource;
}

export function resolveAvatarModelSource(source: string): string {
  const normalizedSource = normalizeAvatarModelSource(source);

  if (normalizedSource.startsWith(LOCAL_AVATAR_ASSET_PREFIX)) {
    return buildApiUrl(normalizedSource);
  }

  return normalizedSource;
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

  try {
    const rewrittenSettings = await rewriteFileReferences(
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
  } catch (error) {
    revokeObjectUrls(objectUrls);
    throw error;
  }
}

export async function saveAvatarZip(file: File): Promise<StoredAvatarZip> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(buildApiUrl("/avatar/live2d/zip"), {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<StoredAvatarZip>;
}

export async function loadAvatarZip(localModelName?: string): Promise<File | null> {
  const filename = localModelName?.trim();
  if (!filename || typeof File === "undefined") {
    return null;
  }

  const response = await fetch(
    buildApiUrl(`/avatar/assets/live2d/uploads/${encodeURIComponent(filename)}`),
  );

  if (!response.ok) {
    return null;
  }

  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || "application/zip",
  });
}
