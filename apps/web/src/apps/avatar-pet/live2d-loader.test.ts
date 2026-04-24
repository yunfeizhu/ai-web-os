import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "idb-keyval";

import {
  classifyLive2DSource,
  findModelSettingsPath,
  isLive2DZipSource,
  loadAvatarZip,
  prepareZipModelBlob,
} from "./live2d-loader";

vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const createdObjectUrls = new Map<string, Blob>();
const revokedObjectUrls: string[] = [];
let nextObjectUrlId = 0;

async function createZipBlob(entries: Record<string, string | Uint8Array>) {
  const zip = new JSZip();

  for (const [path, contents] of Object.entries(entries)) {
    zip.file(path, contents);
  }

  return zip.generateAsync({ type: "blob" });
}

async function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Failed to read blob")),
    );
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  createdObjectUrls.clear();
  revokedObjectUrls.length = 0;
  nextObjectUrlId = 0;
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "",
    });
  }
  if (!("revokeObjectURL" in URL)) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
  }
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:live2d-test/${nextObjectUrlId++}`;
    createdObjectUrls.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revokedObjectUrls.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyLive2DSource", () => {
  it("classifies model3 json sources", () => {
    const source = "/avatar/live2d/hiyori/hiyori.model3.json";

    expect(classifyLive2DSource(source)).toEqual({
      kind: "model3-json",
      source,
    });
  });

  it("classifies model3 json sources with query or hash fragments", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori.model3.json?v=1")).toEqual({
      kind: "model3-json",
      source: "/avatar/live2d/hiyori.model3.json?v=1",
    });
    expect(classifyLive2DSource("/avatar/live2d/hiyori.model3.json#cache")).toEqual({
      kind: "model3-json",
      source: "/avatar/live2d/hiyori.model3.json#cache",
    });
  });

  it("classifies zip sources", () => {
    const source = "/avatar/live2d/hiyori.zip";

    expect(classifyLive2DSource(source)).toEqual({
      kind: "zip",
      source,
    });
  });

  it("classifies zip sources with query or hash fragments", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori.zip?v=1")).toEqual({
      kind: "zip",
      source: "/avatar/live2d/hiyori.zip?v=1",
    });
    expect(classifyLive2DSource("/avatar/live2d/hiyori.zip#cache")).toEqual({
      kind: "zip",
      source: "/avatar/live2d/hiyori.zip#cache",
    });
  });

  it("classifies empty sources as missing", () => {
    expect(classifyLive2DSource("")).toEqual({
      kind: "missing",
      source: "",
    });
  });

  it("trims sources before classifying and returning them", () => {
    expect(classifyLive2DSource("  /avatar/live2d/HIYORI.MODEL3.JSON  ")).toEqual({
      kind: "model3-json",
      source: "/avatar/live2d/HIYORI.MODEL3.JSON",
    });
  });

  it("classifies unrecognized non-empty sources as unknown", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori.txt")).toEqual({
      kind: "unknown",
      source: "/avatar/live2d/hiyori.txt",
    });
  });
});

describe("isLive2DZipSource", () => {
  it("returns true for zip sources", () => {
    expect(isLive2DZipSource("/x/y.zip")).toBe(true);
  });

  it("returns false for model3 json sources", () => {
    expect(isLive2DZipSource("/x/y.model3.json")).toBe(false);
  });

  it("matches zip extensions case-insensitively after trimming", () => {
    expect(isLive2DZipSource("  /x/y.ZIP  ")).toBe(true);
  });

  it("returns true for zip sources with query or hash fragments", () => {
    expect(isLive2DZipSource("/x/y.zip?cache=1")).toBe(true);
    expect(isLive2DZipSource("/x/y.zip#cache")).toBe(true);
  });
});

describe("findModelSettingsPath", () => {
  it("prefers model3 json settings over model json settings", () => {
    expect(
      findModelSettingsPath(["foo/model.model.json", "foo/model.model3.json"]),
    ).toBe("foo/model.model3.json");
  });

  it("normalizes backslashes in the returned settings path", () => {
    expect(findModelSettingsPath(["foo\\bar\\model.model3.json"])).toBe(
      "foo/bar/model.model3.json",
    );
  });

  it("falls back to model json settings when model3 json is absent", () => {
    expect(findModelSettingsPath(["foo/model.model.json"])).toBe(
      "foo/model.model.json",
    );
  });

  it("returns null when no model settings path is present", () => {
    expect(findModelSettingsPath(["foo/readme.txt", "foo/texture.png"])).toBeNull();
  });
});

describe("prepareZipModelBlob", () => {
  it("returns a blob URL for rewritten model3 settings and referenced assets", async () => {
    const zipBlob = await createZipBlob({
      "model\\legacy.model.json": JSON.stringify({
        FileReferences: {
          Moc: "legacy.moc",
        },
      }),
      "model\\avatar.model3.json": JSON.stringify({
        FileReferences: {
          Moc: "avatar.moc3",
          Textures: ["textures\\texture_00.png"],
          Physics: "physics.json",
          Pose: "pose.json",
          DisplayInfo: "display-info.json",
          Expressions: [
            { Name: "smile", File: "expressions/smile.exp3.json" },
            { Name: "remote", File: "https://example.com/remote.exp3.json" },
          ],
          Motions: {
            Idle: [
              { File: "motions/idle.motion3.json", Sound: "sounds/idle.wav" },
            ],
          },
        },
        Groups: [{ Target: "Parameter", Name: "EyeBlink", Ids: ["ParamEyeLOpen"] }],
        ExternalData: "data:application/json;base64,e30=",
        AlreadyPrepared: "blob:existing-model-asset",
        Label: "textures/not-in-zip.png",
      }),
      "model\\avatar.moc3": new Uint8Array([1]),
      "model\\textures\\texture_00.png": new Uint8Array([2]),
      "model\\physics.json": "{}",
      "model\\pose.json": "{}",
      "model\\display-info.json": "{}",
      "model\\expressions\\smile.exp3.json": "{}",
      "model\\motions\\idle.motion3.json": "{}",
      "model\\sounds\\idle.wav": new Uint8Array([3]),
    });

    const prepared = await prepareZipModelBlob(zipBlob);

    expect(prepared.modelSettingsPath).toBe("model/avatar.model3.json");
    expect(prepared.objectUrl).toMatch(/^blob:/);
    expect(prepared.objectUrls).toContain(prepared.objectUrl);
    expect(prepared.objectUrls).toHaveLength(9);

    const rewrittenSettingsBlob = createdObjectUrls.get(prepared.objectUrl);
    expect(rewrittenSettingsBlob).toBeInstanceOf(Blob);

    const rewrittenSettings = JSON.parse(await readBlobText(rewrittenSettingsBlob!));
    expect(rewrittenSettings.FileReferences.Moc).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Textures[0]).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Physics).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Pose).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.DisplayInfo).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Expressions[0].File).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Expressions[1].File).toBe(
      "https://example.com/remote.exp3.json",
    );
    expect(rewrittenSettings.FileReferences.Motions.Idle[0].File).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Motions.Idle[0].Sound).toMatch(/^blob:/);
    expect(rewrittenSettings.Groups[0].Ids[0]).toBe("ParamEyeLOpen");
    expect(rewrittenSettings.ExternalData).toBe("data:application/json;base64,e30=");
    expect(rewrittenSettings.AlreadyPrepared).toBe("blob:existing-model-asset");
    expect(rewrittenSettings.Label).toBe("textures/not-in-zip.png");
  });

  it("throws a readable error when the zip has no model settings file", async () => {
    const zipBlob = await createZipBlob({
      "model/readme.txt": "not a model",
      "model/texture.png": new Uint8Array([1]),
    });

    await expect(prepareZipModelBlob(zipBlob)).rejects.toThrow(
      "No Live2D model settings file found in ZIP",
    );
  });

  it("does not rewrite semantic Cubism strings when they collide with zip entries", async () => {
    const zipBlob = await createZipBlob({
      "model/avatar.model3.json": JSON.stringify({
        FileReferences: {
          Moc: "avatar.moc3",
          Textures: ["texture.png"],
          Expressions: [{ Name: "smile.exp3.json", File: "smile.exp3.json" }],
          Motions: {
            Idle: [
              {
                Name: "idle.motion3.json",
                File: "idle.motion3.json",
                Sound: "idle.wav",
              },
            ],
          },
        },
        Groups: [
          {
            Target: "Parameter",
            Name: "EyeBlink",
            Ids: ["ParamEyeLOpen"],
          },
        ],
      }),
      "model/avatar.moc3": new Uint8Array([1]),
      "model/texture.png": new Uint8Array([2]),
      "model/smile.exp3.json": "{}",
      "model/idle.motion3.json": "{}",
      "model/idle.wav": new Uint8Array([3]),
      "model/Parameter": "semantic collision",
      "model/EyeBlink": "semantic collision",
      "model/ParamEyeLOpen": "semantic collision",
    });

    const prepared = await prepareZipModelBlob(zipBlob);
    const rewrittenSettingsBlob = createdObjectUrls.get(prepared.objectUrl);
    const rewrittenSettings = JSON.parse(await readBlobText(rewrittenSettingsBlob!));

    expect(rewrittenSettings.FileReferences.Moc).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Expressions[0].File).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Expressions[0].Name).toBe(
      "smile.exp3.json",
    );
    expect(rewrittenSettings.FileReferences.Motions.Idle[0].File).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Motions.Idle[0].Sound).toMatch(/^blob:/);
    expect(rewrittenSettings.FileReferences.Motions.Idle[0].Name).toBe(
      "idle.motion3.json",
    );
    expect(rewrittenSettings.Groups[0]).toEqual({
      Target: "Parameter",
      Name: "EyeBlink",
      Ids: ["ParamEyeLOpen"],
    });
  });

  it("falls back to Cubism 2 model json settings and rewrites only file-bearing fields", async () => {
    const zipBlob = await createZipBlob({
      "model/avatar.model.json": JSON.stringify({
        model: "avatar.moc",
        textures: ["textures/texture_00.png", "https://example.com/remote.png"],
        physics: "physics.json",
        pose: "pose.json",
        expressions: [
          { name: "smile.exp.json", file: "expressions/smile.exp.json" },
        ],
        motions: {
          idle: [
            {
              name: "idle.motion.json",
              file: "motions/idle.motion.json",
              sound: "sounds/idle.wav",
            },
          ],
        },
        hit_areas_custom: {
          body: "textures/texture_00.png",
        },
      }),
      "model/avatar.moc": new Uint8Array([1]),
      "model/textures/texture_00.png": new Uint8Array([2]),
      "model/physics.json": "{}",
      "model/pose.json": "{}",
      "model/expressions/smile.exp.json": "{}",
      "model/motions/idle.motion.json": "{}",
      "model/sounds/idle.wav": new Uint8Array([3]),
      "model/smile.exp.json": "semantic collision",
      "model/idle.motion.json": "semantic collision",
    });

    const prepared = await prepareZipModelBlob(zipBlob);

    expect(prepared.modelSettingsPath).toBe("model/avatar.model.json");
    expect(prepared.objectUrls).toHaveLength(8);

    const rewrittenSettingsBlob = createdObjectUrls.get(prepared.objectUrl);
    expect(rewrittenSettingsBlob).toBeInstanceOf(Blob);

    const rewrittenSettings = JSON.parse(await readBlobText(rewrittenSettingsBlob!));
    expect(rewrittenSettings.model).toMatch(/^blob:/);
    expect(rewrittenSettings.textures[0]).toMatch(/^blob:/);
    expect(rewrittenSettings.textures[1]).toBe("https://example.com/remote.png");
    expect(rewrittenSettings.physics).toMatch(/^blob:/);
    expect(rewrittenSettings.pose).toMatch(/^blob:/);
    expect(rewrittenSettings.expressions[0].file).toMatch(/^blob:/);
    expect(rewrittenSettings.expressions[0].name).toBe("smile.exp.json");
    expect(rewrittenSettings.motions.idle[0].file).toMatch(/^blob:/);
    expect(rewrittenSettings.motions.idle[0].sound).toMatch(/^blob:/);
    expect(rewrittenSettings.motions.idle[0].name).toBe("idle.motion.json");
    expect(rewrittenSettings.hit_areas_custom.body).toBe("textures/texture_00.png");
  });

  it("revokes already-created object URLs when zip preparation fails", async () => {
    const zipBlob = await createZipBlob({
      "model/avatar.model3.json": JSON.stringify({
        FileReferences: {
          Moc: "avatar.moc3",
          Textures: ["texture.png"],
        },
      }),
      "model/avatar.moc3": new Uint8Array([1]),
      "model/texture.png": new Uint8Array([2]),
    });
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    createObjectUrl
      .mockImplementationOnce((blob) => {
        const url = `blob:live2d-test/${nextObjectUrlId++}`;
        createdObjectUrls.set(url, blob as Blob);
        return url;
      })
      .mockImplementationOnce(() => {
        throw new Error("object URL quota exceeded");
      });

    await expect(prepareZipModelBlob(zipBlob)).rejects.toThrow(
      "object URL quota exceeded",
    );
    expect(revokedObjectUrls).toEqual(["blob:live2d-test/0"]);
  });
});

describe("loadAvatarZip", () => {
  it("returns null when cached data is a Blob and File is unavailable", async () => {
    const cached = new Blob(["zip"], { type: "application/zip" });
    const originalFile = globalThis.File;

    vi.mocked(get).mockResolvedValue(cached);
    Reflect.deleteProperty(globalThis, "File");

    try {
      await expect(loadAvatarZip()).resolves.toBeNull();
    } finally {
      Object.defineProperty(globalThis, "File", {
        configurable: true,
        writable: true,
        value: originalFile,
      });
    }
  });

  it("returns a cached File and wraps cached Blob data when File is available", async () => {
    const cachedFile = new File(["zip"], "cached.zip", {
      type: "application/zip",
    });

    vi.mocked(get).mockResolvedValue(cachedFile);
    await expect(loadAvatarZip()).resolves.toBe(cachedFile);

    const cachedBlob = new Blob(["zip"], { type: "application/x-zip-compressed" });
    vi.mocked(get).mockResolvedValue(cachedBlob);

    const loaded = await loadAvatarZip();

    expect(loaded).toBeInstanceOf(File);
    expect(loaded?.name).toBe("avatar-live2d.zip");
    expect(loaded?.type).toBe("application/x-zip-compressed");
  });
});
