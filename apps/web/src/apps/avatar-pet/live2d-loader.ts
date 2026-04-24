export type Live2DSourceKind = "missing" | "model3-json" | "zip" | "unknown";

export type Live2DSourceClassification = {
  kind: Live2DSourceKind;
  source: string;
};

const MODEL3_JSON_EXTENSION = ".model3.json";
const MODEL_JSON_EXTENSION = ".model.json";
const ZIP_EXTENSION = ".zip";

function hasExtension(source: string, extension: string): boolean {
  return source.toLowerCase().endsWith(extension);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
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
