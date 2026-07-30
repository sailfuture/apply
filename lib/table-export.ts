/**
 * Generic CSV-export + clipboard-copy helpers for the admin list pages.
 *
 * Each page supplies an ordered column list (label + how to read the
 * value off a row) and gets three consistent outputs from it: a CSV
 * download, a spreadsheet-friendly TSV clipboard payload, and an HTML
 * table for rich paste targets. Driving all three from ONE list is the
 * point — the CSV and the clipboard can never drift apart.
 */

export interface ExportColumn<T> {
  label: string;
  value: (row: T) => string;
}

/** RFC-4180 cell escaping — quote when the value holds a comma, quote,
 *  or newline; double any embedded quotes. */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Strip tabs / newlines so a value can't break TSV's cell + row
 *  delimiters when pasted into Excel or Sheets. */
function tsvCell(v: string): string {
  return v.replace(/[\t\r\n]+/g, " ").trim();
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build CSV text. A UTF-8 BOM is prepended so Excel detects the
 * encoding (accented names render correctly) and rows are CRLF-joined
 * per RFC 4180.
 */
export function buildCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  }
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}

/** Tab-separated text — what spreadsheets expect from a paste. */
export function buildTsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => tsvCell(c.label)).join("\t")];
  for (const r of rows) {
    lines.push(columns.map((c) => tsvCell(c.value(r))).join("\t"));
  }
  return lines.join("\n");
}

/** Real `<table>` markup so a paste into Docs / Word / email lands as a
 *  formatted table rather than a wall of tab-separated text. */
export function buildHtmlTable<T>(
  columns: ExportColumn<T>[],
  rows: T[]
): string {
  const head = columns
    .map((c) => `<th style="text-align:left">${escapeHtml(c.label)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td>${escapeHtml(c.value(r))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Trigger a client-side download of `text` as `filename`. */
export function downloadTextFile(
  filename: string,
  text: string,
  mime: string
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download rows as `<prefix>-<scope>-<today>.csv`. `scope` is slugified
 * so a filter label with spaces/slashes still yields a clean filename.
 */
export function downloadCsv<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  prefix: string,
  scope: string
): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeScope = scope.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-|-$/g, "");
  downloadTextFile(
    `${prefix}-${safeScope}-${stamp}.csv`,
    buildCsv(columns, rows),
    "text/csv;charset=utf-8;"
  );
}

/**
 * Copy rows to the clipboard with BOTH a spreadsheet-friendly
 * text/plain (TSV) flavor and a text/html table, letting the paste
 * target pick. Falls back to plain-text-only when the richer
 * `ClipboardItem` API isn't available (older Safari/Firefox) — the
 * spreadsheet case still works there.
 */
export async function copyTableToClipboard<T>(
  columns: ExportColumn<T>[],
  rows: T[]
): Promise<void> {
  const tsv = buildTsv(columns, rows);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([buildHtmlTable(columns, rows)], {
            type: "text/html",
          }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the plain-text path below.
    }
  }

  await navigator.clipboard.writeText(tsv);
}
