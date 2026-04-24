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

  object[key] = await Promise.all(
    value.map((item) =>
      typeof item === "string"
        ? createAssetObjectUrl(
            item,
            baseDirectory,
            entries,
            objectUrlByPath,
            objectUrls,
          )
        : item,
    ),
  );
}

async function rewriteFileReferences(
  modelSettings: unknown,
  baseDirectory: string,
  entries: Map<string, JSZipObject>,
  objectUrlByPath: Map<string, string>,
  objectUrls: string[],
): Promise<unknown> {
  if (!isPlainObject(modelSettings) || !isPlainObject(modelSettings.FileReferences)) {
    return modelSettings;
  }

  const rewrittenSettings = structuredClone(modelSettings);
  const fileReferences = rewrittenSettings.FileReferences as Record<string, unknown>;

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
    await Promise.all(
      fileReferences.Expressions.map((expression) =>
        isPlainObject(expression)
          ? rewriteStringProperty(
              expression,
              "File",
              baseDirectory,
              entries,
              objectUrlByPath,
              objectUrls,
            )
          : undefined,
      ),
    );
  }

  if (isPlainObject(fileReferences.Motions)) {
    await Promise.all(
      Object.values(fileReferences.Motions).flatMap((motions) =>
        Array.isArray(motions)
          ? motions.map(async (motion) => {
              if (!isPlainObject(motion)) return;

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
            })
          : [],
      ),
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

export async function saveAvatarZip(file: File): Promise<void> {
  await set(AVATAR_ZIP_CACHE_KEY, file);
}

export async function loadAvatarZip(): Promise<Blob | null> {
  const cached = await get<unknown>(AVATAR_ZIP_CACHE_KEY);

  if (!cached) {
    return null;
  }

  if (typeof File !== "undefined" && cached instanceof File) {
    return cached;
  }

  if (typeof Blob !== "undefined" && cached instanceof Blob) {
    if (typeof File === "undefined") {
      return cached;
    }

    return new File([cached], "avatar-live2d.zip", {
      type: cached.type || "application/zip",
    });
  }

  return null;
}
