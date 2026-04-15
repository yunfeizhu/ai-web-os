"use client";

import * as XLSX from "xlsx";

export interface SpreadsheetSheet {
  name: string;
  cells: string[][];
}

export interface SpreadsheetWorkbookData {
  sheets: SpreadsheetSheet[];
  bookType: XLSX.BookType;
}

const SPREADSHEET_EXTENSIONS = new Set([
  "csv",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
]);

export function isSpreadsheetFileName(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return SPREADSHEET_EXTENSIONS.has(ext);
}

export function getSpreadsheetBookType(name: string): XLSX.BookType {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "csv":
      return "csv";
    case "xls":
      return "xls";
    case "ods":
      return "ods";
    case "xlsm":
      return "xlsm";
    default:
      return "xlsx";
  }
}

export function columnLabel(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function getSheetDimensions(cells: string[][]) {
  const rows = cells.length;
  const cols = cells.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows, cols };
}

function normalizeCellValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

function normalizeSheetCells(rows: unknown[][]) {
  const normalized = rows.map((row) => row.map((cell) => normalizeCellValue(cell)));
  return normalized.length ? normalized : [[""]];
}

function trimSheetCells(cells: string[][]) {
  let lastRow = -1;
  let lastCol = -1;

  cells.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (String(cell ?? "").trim() !== "") {
        lastRow = Math.max(lastRow, rowIndex);
        lastCol = Math.max(lastCol, colIndex);
      }
    });
  });

  if (lastRow === -1 || lastCol === -1) {
    return [[""]];
  }

  return cells.slice(0, lastRow + 1).map((row) => {
    const next = row.slice(0, lastCol + 1);
    while (next.length < lastCol + 1) {
      next.push("");
    }
    return next;
  });
}

export function parseSpreadsheetBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): SpreadsheetWorkbookData {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
  });

  const sheets = (workbook.SheetNames.length ? workbook.SheetNames : ["Sheet1"]).map((name) => {
    const worksheet = workbook.Sheets[name] ?? XLSX.utils.aoa_to_sheet([[""]]);
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: true,
    }) as unknown[][];

    return {
      name,
      cells: normalizeSheetCells(rows),
    };
  });

  return {
    sheets: sheets.length ? sheets : [{ name: "Sheet1", cells: [[""]] }],
    bookType: getSpreadsheetBookType(fileName),
  };
}

export function serializeSpreadsheetWorkbook(
  sheets: SpreadsheetSheet[],
  fileName: string,
) {
  const bookType = getSpreadsheetBookType(fileName);
  const workbook = XLSX.utils.book_new();
  const normalizedSheets = sheets.length ? sheets : [{ name: "Sheet1", cells: [[""]] }];
  const targetSheets = bookType === "csv" ? normalizedSheets.slice(0, 1) : normalizedSheets;

  targetSheets.forEach((sheet, index) => {
    const name = sheet.name.trim() || `Sheet${index + 1}`;
    const worksheet = XLSX.utils.aoa_to_sheet(trimSheetCells(sheet.cells));
    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
  });

  return XLSX.write(workbook, {
    bookType,
    type: "array",
  }) as ArrayBuffer;
}

export function getSpreadsheetPreview(sheet: SpreadsheetSheet, maxRows = 8, maxCols = 6) {
  const cells = sheet.cells.slice(0, maxRows).map((row) => {
    const next = row.slice(0, maxCols);
    while (next.length < maxCols) {
      next.push("");
    }
    return next;
  });

  while (cells.length < Math.min(maxRows, Math.max(sheet.cells.length, 1))) {
    cells.push(Array.from({ length: maxCols }, () => ""));
  }

  const dimensions = getSheetDimensions(sheet.cells);

  return {
    name: sheet.name,
    cells,
    totalRows: dimensions.rows,
    totalCols: dimensions.cols,
  };
}
