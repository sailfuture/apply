import type { CampusVisitRow } from "@/app/api/admin/campus-visits/route";
import { formatUSPhone } from "@/lib/phone";

/**
 * CSV export + clipboard copy for the admin Campus Visits table.
 *
 * Deliberately wider than the on-screen table: the rendered grid trims
 * email, academic year and the signature link to keep rows single-line,
 * but an export is expected to carry everything on the record. One
 * column list drives both the CSV and the clipboard payload so the two
 * can never drift apart.
 */

const COLUMNS: Array<{
  label: string;
  value: (r: CampusVisitRow) => string;
}> = [
  {
    label: "Signed",
    value: (r) => (r.signed_ts ? new Date(r.signed_ts).toLocaleString() : ""),
  },
  { label: "Academic Year", value: (r) => r.academic_year ?? "" },
  { label: "Parent Name", value: (r) => r.parent_name ?? "" },
  { label: "Parent Email", value: (r) => r.parent_email ?? "" },
  {
    label: "Parent Phone",
    value: (r) =>
      r.parent_phone ? formatUSPhone(r.parent_phone) || r.parent_phone : "",
  },
  { label: "Student Name", value: (r) => r.student_name ?? "" },
  { label: "Student Grade", value: (r) => r.student_grade ?? "" },
  { label: "Current School", value: (r) => r.student_school ?? "" },
  {
    label: "Marketing Opt-In",
    value: (r) => (r.marketing_opt_in ? "Yes" : "No"),
  },
  { label: "Signature URL", value: (r) => r.signature_url ?? "" },
];

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
 * Build the CSV text. A UTF-8 BOM is prepended so Excel detects the
 * encoding (accented names render correctly) and rows are CRLF-joined
 * per RFC 4180 — same conventions as the SUFS export.
 */
export function buildCampusVisitsCsv(rows: CampusVisitRow[]): string {
  const lines = [COLUMNS.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) {
    lines.push(COLUMNS.map((c) => csvCell(c.value(r))).join(","));
  }
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}

/** Tab-separated text — what spreadsheets expect from a paste. */
export function buildCampusVisitsTsv(rows: CampusVisitRow[]): string {
  const lines = [COLUMNS.map((c) => tsvCell(c.label)).join("\t")];
  for (const r of rows) {
    lines.push(COLUMNS.map((c) => tsvCell(c.value(r))).join("\t"));
  }
  return lines.join("\n");
}

/** Real `<table>` markup so a paste into Docs / Word / email lands as a
 *  formatted table rather than a wall of tab-separated text. */
function buildCampusVisitsHtml(rows: CampusVisitRow[]): string {
  const head = COLUMNS.map(
    (c) => `<th style="text-align:left">${escapeHtml(c.label)}</th>`
  ).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${COLUMNS.map(
          (c) => `<td>${escapeHtml(c.value(r))}</td>`
        ).join("")}</tr>`
    )
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Trigger a client-side download of `text` as `filename`. */
function downloadTextFile(filename: string, text: string, mime: string) {
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

/** Download the given rows as a dated .csv. `scope` tags the filename
 *  (the selected academic year, or "all-years"). */
export function downloadCampusVisitsCsv(
  rows: CampusVisitRow[],
  scope: string
): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeScope = scope.replace(/[^a-zA-Z0-9-]+/g, "-");
  downloadTextFile(
    `campus-visits-${safeScope}-${stamp}.csv`,
    buildCampusVisitsCsv(rows),
    "text/csv;charset=utf-8;"
  );
}

/**
 * Copy the rows to the clipboard with BOTH a spreadsheet-friendly
 * text/plain (TSV) flavor and a text/html table, letting the paste
 * target pick. Falls back to plain-text-only when the richer
 * `ClipboardItem` API isn't available (older Safari/Firefox) — the
 * spreadsheet case still works there.
 */
export async function copyCampusVisitsTable(
  rows: CampusVisitRow[]
): Promise<void> {
  const tsv = buildCampusVisitsTsv(rows);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([buildCampusVisitsHtml(rows)], {
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
