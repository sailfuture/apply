import type {
  PipelineExportRow,
  PipelineExportColumn,
} from "./pipeline-export-columns";
import { parseDateUs } from "./us-date";

/**
 * Build and download an .xlsx of the admissions pipeline. Browser-only —
 * `exceljs` is dynamically imported so its weight only ships when the
 * admin actually exports (same pattern as `lib/enrolled-export.ts`).
 * Rows become spreadsheet rows; the chosen `columns` become the header
 * + cell projection, in the order given.
 */
export async function exportPipelineXlsx({
  rows,
  columns,
  filename,
}: {
  rows: PipelineExportRow[];
  columns: PipelineExportColumn[];
  filename: string;
}): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SailFuture Apply";
  const sheet = workbook.addWorksheet("Admissions Pipeline");

  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(40, Math.max(12, c.label.length + 4)),
  }));

  for (const row of rows) {
    const record: Record<string, string | Date> = {};
    for (const c of columns) {
      const value = row[c.key];
      const text = typeof value === "string" ? value : String(value ?? "");
      // Date columns go in as real Excel dates so they sort and filter
      // by date. A blank, or a family-mode cell joining several
      // students' dates, stays text.
      record[c.key] = (c.date && parseDateUs(text)) || text;
    }
    sheet.addRow(record);
  }
  // Shown month-first, like every date in the app.
  columns.forEach((c, i) => {
    if (c.date) sheet.getColumn(i + 1).numFmt = "mm/dd/yyyy";
  });

  // Bold + frozen header row, with an autofilter across the columns so
  // the recipient can sort/filter the sheet in Excel immediately.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const safeName =
    filename
      .replace(/\.xlsx$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim() || "admissions-pipeline";
  triggerDownload(blob, `${safeName}.xlsx`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click can kick off the download
  // before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
