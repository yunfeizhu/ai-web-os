"use client";

import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { apiFetch } from "@/lib/backend";
import { downloadFileBuffer } from "@/lib/file-download-cache";
import { getSpreadsheetBookType } from "@/apps/spreadsheet-viewer/spreadsheet-utils";

interface SpreadsheetEditorProps {
  appState?: Record<string, unknown>;
  windowId: string;
}

type PrimitiveCellValue = string | number | boolean | null;

type ParsedSheetCell = {
  value: PrimitiveCellValue;
  formula?: string;
};

type ParsedSheet = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<number, Record<number, ParsedSheetCell>>;
};

type ParsedWorkbook = {
  id: string;
  name: string;
  sheets: ParsedSheet[];
};

type UniverCellData = {
  v?: PrimitiveCellValue;
  f?: string | null;
};

type UniverRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type UniverWorksheetSnapshot = {
  id: string;
  name: string;
  tabColor: string;
  hidden: number;
  freeze: {
    xSplit: number;
    ySplit: number;
    startRow: number;
    startColumn: number;
  };
  rowCount: number;
  columnCount: number;
  zoomRatio: number;
  scrollTop: number;
  scrollLeft: number;
  defaultColumnWidth: number;
  defaultRowHeight: number;
  mergeData: UniverRange[];
  cellData: Record<number, Record<number, UniverCellData>>;
  rowData: Record<number, unknown>;
  columnData: Record<number, unknown>;
  rowHeader: {
    width: number;
    hidden?: number;
  };
  columnHeader: {
    height: number;
    hidden?: number;
  };
  showGridlines: number;
  rightToLeft: number;
};

type UniverWorkbookSnapshot = {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  styles: Record<string, unknown>;
  sheetOrder: string[];
  sheets: Record<string, Partial<UniverWorksheetSnapshot>>;
};

type UniverDisposable = {
  dispose(): void;
};

type UniverInstance = {
  dispose(): void;
};

type UniverWorkbookApi = {
  save(): UniverWorkbookSnapshot;
};

type UniverApi = {
  createWorkbook(data: UniverWorkbookSnapshot): UniverWorkbookApi;
};

const MIN_VISIBLE_ROWS = 200;
const MIN_VISIBLE_COLS = 26;
const DEFAULT_COLUMN_WIDTH = 88;
const DEFAULT_ROW_HEIGHT = 28;

export function SpreadsheetEditor({ appState }: SpreadsheetEditorProps) {
  const filePath = typeof appState?.filePath === "string" ? appState.filePath : "";
  const fileId = typeof appState?.fileId === "string" ? appState.fileId : "";
  const fileName = useMemo(
    () => filePath.split("/").filter(Boolean).at(-1) ?? "Workbook.xlsx",
    [filePath],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<UniverInstance | null>(null);
  const workbookRef = useRef<UniverWorkbookApi | null>(null);
  const commandListenerRef = useRef<UniverDisposable | null>(null);

  const [loadingFile, setLoadingFile] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!filePath || !fileId) {
      disposeUniverRuntime(univerRef, workbookRef, commandListenerRef, containerRef);
      setReady(false);
      setLoadingFile(false);
      setInitializing(false);
      setSaving(false);
      setStatusMessage("");
      setErrorMessage("当前没有可编辑的表格文件。");
      return;
    }

    let cancelled = false;

    setReady(false);
    setLoadingFile(true);
    setInitializing(false);
    setStatusMessage("");
    setErrorMessage("");

    disposeUniverRuntime(univerRef, workbookRef, commandListenerRef, containerRef);

    downloadFileBuffer(fileId)
      .then(async (buffer) => {
        if (cancelled) return;

        const parsedWorkbook = parseWorkbookBuffer(buffer, fileName);
        const snapshot = buildUniverWorkbookSnapshot(parsedWorkbook);

        setLoadingFile(false);
        setInitializing(true);

        const [presetsModule, sheetsPresetModule, zhCnLocaleModule] = await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/preset-sheets-core"),
          import("@univerjs/preset-sheets-core/locales/zh-CN"),
        ]);

        const container = await waitForContainer(containerRef, () => cancelled);
        if (cancelled) return;
        if (!container) {
          setInitializing(false);
          setReady(false);
          setStatusMessage("");
          setErrorMessage("表格编辑器初始化失败，请重试。");
          return;
        }

        const localeKey = presetsModule.LocaleType?.ZH_CN ?? "zhCN";
        const preset = sheetsPresetModule.UniverSheetsCorePreset({
          container,
          header: false,
          toolbar: false,
          menu: {},
          formulaBar: true,
          footer: {
            sheetBar: true,
            statisticBar: false,
            menus: false,
            zoomSlider: false,
          },
          contextMenu: true,
        });

        const { univer, univerAPI } = presetsModule.createUniver({
          locale: localeKey,
          locales: {
            [localeKey]: zhCnLocaleModule.default,
          },
          presets: [preset],
        }) as {
          univer: UniverInstance;
          univerAPI: UniverApi;
        };

        const workbookApi = univerAPI.createWorkbook(snapshot);

        univerRef.current = univer;
        workbookRef.current = workbookApi;

        setInitializing(false);
        setReady(true);
        setStatusMessage("Univer Sheets 已就绪");
      })
      .catch(() => {
        if (cancelled) return;
        disposeUniverRuntime(univerRef, workbookRef, commandListenerRef, containerRef);
        setReady(false);
        setLoadingFile(false);
        setInitializing(false);
        setStatusMessage("");
        setErrorMessage("表格加载失败，请稍后再试。");
      });

    return () => {
      cancelled = true;
      disposeUniverRuntime(univerRef, workbookRef, commandListenerRef, containerRef);
    };
  }, [fileId, fileName, filePath]);

  const saveWorkbook = async () => {
    if (!filePath || !workbookRef.current || saving) return;

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const snapshot = workbookRef.current.save();
      const buffer = serializeUniverWorkbookSnapshot(snapshot, fileName);
      const contentBase64 = arrayBufferToBase64(buffer);

      await apiFetch("/files/binary-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          content_base64: contentBase64,
        }),
      });

      setStatusMessage("已保存");
    } catch {
      setErrorMessage("保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const helperText = errorMessage
    || (loadingFile
      ? "正在加载表格文件..."
      : initializing
        ? "正在初始化 Univer Sheets..."
        : saving
          ? "正在保存..."
          : statusMessage || "支持 xlsx / xls / xlsm / ods / csv");

  return (
    <div
      data-desktop-blocker="true"
      className="flex h-full min-w-0 flex-col"
      style={{ color: "var(--t1)" }}
      onContextMenu={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        className="flex items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: "rgba(0,0,0,0.08)" }}
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{fileName}</div>
          <div className="truncate text-[12px]" style={{ color: "var(--t3)" }}>
            {filePath || "未指定文件路径"}
          </div>
        </div>

        <button
          onClick={() => {
            void saveWorkbook();
          }}
          disabled={!filePath || !ready || loadingFile || initializing || saving}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]"
          style={{
            background: "rgba(0,0,0,0.05)",
            opacity: !filePath || !ready || loadingFile || initializing || saving ? 0.5 : 1,
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? "保存中" : "保存"}
        </button>
      </div>

      <div
        className="border-b px-4 py-2 text-[12px]"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          color: errorMessage ? "#b91c1c" : "var(--t3)",
        }}
      >
        {helperText}
      </div>

      <div className="min-h-0 flex-1 bg-slate-50/70 p-3">
        {!filePath || !fileId ? (
          <EmptyState text="当前没有可编辑的表格文件" />
        ) : loadingFile ? (
          <LoadingState text={loadingFile ? "正在读取表格文件..." : "正在启动 Univer Sheets..."} />
        ) : errorMessage ? (
          <EmptyState text={errorMessage} tone="danger" />
        ) : (
          <div
            className="relative h-full overflow-hidden rounded-2xl border bg-white shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
            style={{ borderColor: "rgba(15,23,42,0.08)" }}
          >
            <div
              ref={containerRef}
              className="h-full w-full"
              style={{ userSelect: "text" }}
            />
            {initializing && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-white/78 backdrop-blur-[1px]"
                style={{ color: "var(--t3)" }}
              >
                <div className="flex items-center gap-2 text-[13px]">
                  <Loader2 size={16} className="animate-spin" />
                  正在启动 Univer Sheets...
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function parseWorkbookBuffer(buffer: ArrayBuffer, fileName: string): ParsedWorkbook {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });
  const sheetNames = workbook.SheetNames.length ? workbook.SheetNames : ["Sheet1"];

  return {
    id: createId("workbook"),
    name: stripExtension(fileName) || "Workbook",
    sheets: sheetNames.map((sheetName, index) =>
      parseWorksheet(sheetName, workbook.Sheets[sheetName], index),
    ),
  };
}

function parseWorksheet(name: string, worksheet: XLSX.WorkSheet | undefined, index: number): ParsedSheet {
  const ref = worksheet?.["!ref"] ?? "A1";
  const range = XLSX.utils.decode_range(ref);
  const rowCount = Math.max(range.e.r + 1, MIN_VISIBLE_ROWS, 1);
  const columnCount = Math.max(range.e.c + 1, MIN_VISIBLE_COLS, 1);
  const cells: Record<number, Record<number, ParsedSheetCell>> = {};

  if (worksheet) {
    Object.entries(worksheet).forEach(([address, rawCell]) => {
      if (address.startsWith("!")) return;
      const position = XLSX.utils.decode_cell(address);
      const cell = parseSheetCell(rawCell as XLSX.CellObject);
      if (!cell) return;
      cells[position.r] ??= {};
      cells[position.r][position.c] = cell;
    });
  }

  return {
    id: createId(`sheet-${index + 1}`),
    name: name.trim() || `Sheet${index + 1}`,
    rowCount,
    columnCount,
    cells,
  };
}

function parseSheetCell(cell: XLSX.CellObject | undefined): ParsedSheetCell | null {
  if (!cell) return null;

  const formula = typeof cell.f === "string" && cell.f.trim()
    ? `=${cell.f.trim()}`
    : undefined;

  let value: PrimitiveCellValue = null;

  if (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean") {
    value = cell.v;
  } else if (cell.v instanceof Date) {
    value = XLSX.utils.format_cell(cell);
  } else if (cell.v != null) {
    value = String(cell.v);
  }

  if (!formula && (value === null || value === "")) {
    return null;
  }

  return { value, formula };
}

function buildUniverWorkbookSnapshot(parsedWorkbook: ParsedWorkbook): UniverWorkbookSnapshot {
  const sheets: Record<string, Partial<UniverWorksheetSnapshot>> = {};

  parsedWorkbook.sheets.forEach((sheet) => {
    const cellData: Record<number, Record<number, UniverCellData>> = {};

    Object.entries(sheet.cells).forEach(([rowKey, rowCells]) => {
      const row = Number(rowKey);
      Object.entries(rowCells).forEach(([colKey, cell]) => {
        const col = Number(colKey);
        const univerCell = buildUniverCellData(cell);
        if (!univerCell) return;
        cellData[row] ??= {};
        cellData[row][col] = univerCell;
      });
    });

    sheets[sheet.id] = {
      id: sheet.id,
      name: sheet.name,
      tabColor: "",
      hidden: 0,
      freeze: {
        xSplit: 0,
        ySplit: 0,
        startRow: 0,
        startColumn: 0,
      },
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
      defaultRowHeight: DEFAULT_ROW_HEIGHT,
      mergeData: normalizeMergeRanges([]),
      cellData,
      rowData: {},
      columnData: {},
      rowHeader: { width: 46 },
      columnHeader: { height: 28 },
      showGridlines: 1,
      rightToLeft: 0,
    };
  });

  return {
    id: parsedWorkbook.id,
    name: parsedWorkbook.name,
    appVersion: "0.20.1",
    locale: "zhCN",
    styles: {},
    sheetOrder: parsedWorkbook.sheets.map((sheet) => sheet.id),
    sheets,
  };
}

function buildUniverCellData(cell: ParsedSheetCell): UniverCellData | null {
  const hasFormula = typeof cell.formula === "string" && cell.formula.trim() !== "";
  const hasValue = cell.value !== null && cell.value !== "";

  if (!hasFormula && !hasValue) {
    return null;
  }

  const next: UniverCellData = {};

  if (hasFormula) {
    next.f = cell.formula ?? null;
  }

  if (hasValue) {
    next.v = cell.value;
  }

  return next;
}

function serializeUniverWorkbookSnapshot(
  snapshot: UniverWorkbookSnapshot,
  fileName: string,
): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const bookType = getSpreadsheetBookType(fileName);
  const orderedSheetIds = snapshot.sheetOrder.length
    ? snapshot.sheetOrder
    : Object.keys(snapshot.sheets);
  const targetSheetIds = bookType === "csv" ? orderedSheetIds.slice(0, 1) : orderedSheetIds;

  if (!targetSheetIds.length) {
    XLSX.utils.book_append_sheet(workbook, createEmptyWorksheet(), "Sheet1");
  } else {
    targetSheetIds.forEach((sheetId, index) => {
      const sheetSnapshot = snapshot.sheets[sheetId];
      const worksheet = createWorksheetFromSnapshot(sheetSnapshot);
      const sheetName = sanitizeSheetName(sheetSnapshot?.name, index);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });
  }

  return XLSX.write(workbook, {
    bookType,
    type: "array",
  }) as ArrayBuffer;
}

function createWorksheetFromSnapshot(
  sheetSnapshot: Partial<UniverWorksheetSnapshot> | undefined,
): XLSX.WorkSheet {
  const worksheet: XLSX.WorkSheet = {};
  const cellData = sheetSnapshot?.cellData ?? {};
  const bounds = getSnapshotBounds(sheetSnapshot);

  Object.entries(cellData).forEach(([rowKey, rowCells]) => {
    const row = Number(rowKey);
    if (!Number.isFinite(row) || !rowCells) return;

    Object.entries(rowCells).forEach(([colKey, cell]) => {
      const col = Number(colKey);
      if (!Number.isFinite(col) || !hasSnapshotCellContent(cell)) return;

      worksheet[XLSX.utils.encode_cell({ r: row, c: col })] = toSheetJsCell(cell);
    });
  });

  worksheet["!merges"] = toSheetJsMergeRanges(sheetSnapshot?.mergeData ?? []);
  worksheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: bounds.lastRow, c: bounds.lastCol },
  });

  return worksheet;
}

function toSheetJsCell(cell: UniverCellData): XLSX.CellObject {
  const next = {} as XLSX.CellObject;
  const formula = typeof cell.f === "string" && cell.f.trim()
    ? cell.f.trim().replace(/^=/, "")
    : undefined;
  const normalizedValue = normalizeSheetJsValue(cell.v);

  if (formula) {
    next.f = formula;
  }

  if (normalizedValue !== undefined) {
    if (typeof normalizedValue === "number") {
      next.t = "n";
      next.v = normalizedValue;
    } else if (typeof normalizedValue === "boolean") {
      next.t = "b";
      next.v = normalizedValue;
    } else {
      next.t = "s";
      next.v = normalizedValue;
    }
  } else if (!formula) {
    next.t = "s";
    next.v = "";
  }

  return next;
}

function getSnapshotBounds(sheetSnapshot: Partial<UniverWorksheetSnapshot> | undefined) {
  let lastRow = 0;
  let lastCol = 0;

  Object.entries(sheetSnapshot?.cellData ?? {}).forEach(([rowKey, rowCells]) => {
    const row = Number(rowKey);
    if (!Number.isFinite(row) || !rowCells) return;

    Object.entries(rowCells).forEach(([colKey, cell]) => {
      const col = Number(colKey);
      if (!Number.isFinite(col) || !hasSnapshotCellContent(cell)) return;
      lastRow = Math.max(lastRow, row);
      lastCol = Math.max(lastCol, col);
    });
  });

  (sheetSnapshot?.mergeData ?? []).forEach((range) => {
    if (!range) return;
    lastRow = Math.max(lastRow, Math.max(range.endRow - 1, range.startRow));
    lastCol = Math.max(lastCol, Math.max(range.endColumn - 1, range.startColumn));
  });

  return { lastRow, lastCol };
}

function hasSnapshotCellContent(cell: UniverCellData | undefined) {
  if (!cell) return false;

  const hasFormula = typeof cell.f === "string" && cell.f.trim() !== "";
  const hasValue = cell.v !== null && cell.v !== undefined && cell.v !== "";

  return hasFormula || hasValue;
}

function normalizeSheetJsValue(value: PrimitiveCellValue | undefined) {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

function createEmptyWorksheet() {
  const worksheet: XLSX.WorkSheet = {};
  worksheet["!ref"] = "A1";
  return worksheet;
}

function sanitizeSheetName(name: string | undefined, index: number) {
  const fallback = `Sheet${index + 1}`;
  const trimmed = (name ?? "").trim() || fallback;
  return trimmed.slice(0, 31);
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function waitForContainer(
  containerRef: { current: HTMLDivElement | null },
  isCancelled: () => boolean,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (isCancelled()) {
      return null;
    }

    if (containerRef.current) {
      return containerRef.current;
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  return containerRef.current;
}

function normalizeMergeRanges(ranges: UniverRange[]) {
  return ranges.map((range) => ({
    startRow: range.startRow,
    endRow: range.endRow,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
  }));
}

function toSheetJsMergeRanges(ranges: UniverRange[]) {
  return ranges
    .filter((range) => (
      Number.isFinite(range.startRow)
      && Number.isFinite(range.endRow)
      && Number.isFinite(range.startColumn)
      && Number.isFinite(range.endColumn)
      && range.endRow > range.startRow
      && range.endColumn > range.startColumn
    ))
    .map((range) => ({
      s: { r: range.startRow, c: range.startColumn },
      e: { r: range.endRow - 1, c: range.endColumn - 1 },
    }));
}

function disposeUniverRuntime(
  univerRef: { current: UniverInstance | null },
  workbookRef: { current: UniverWorkbookApi | null },
  commandListenerRef: { current: UniverDisposable | null },
  _containerRef: { current: HTMLDivElement | null },
) {
  const commandListener = commandListenerRef.current;
  const univer = univerRef.current;

  commandListenerRef.current = null;
  workbookRef.current = null;
  univerRef.current = null;

  if (!commandListener && !univer) {
    return;
  }

  window.setTimeout(() => {
    commandListener?.dispose();
    univer?.dispose();
  }, 0);
}

function LoadingState({ text }: { text: string }) {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 rounded-2xl border border-dashed text-[13px]"
      style={{
        borderColor: "rgba(15,23,42,0.08)",
        color: "var(--t3)",
        background: "rgba(255,255,255,0.72)",
      }}
    >
      <Loader2 size={16} className="animate-spin" />
      {text}
    </div>
  );
}

function EmptyState({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className="flex h-full items-center justify-center rounded-2xl border border-dashed px-6 text-center text-[13px]"
      style={{
        borderColor: "rgba(15,23,42,0.08)",
        color: tone === "danger" ? "#b91c1c" : "var(--t3)",
        background: "rgba(255,255,255,0.72)",
      }}
    >
      {text}
    </div>
  );
}
