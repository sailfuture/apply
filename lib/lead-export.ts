import type {
  AllLeadRow,
  LeadFunnelStage,
  LeadSource,
} from "@/app/api/admin/all-leads/route";
import { formatUSPhone } from "@/lib/phone";
import { buildCsv, downloadTextFile } from "@/lib/table-export";
import { formatTimestampUs, parseDateUs } from "@/lib/us-date";

/**
 * Spreadsheet export for the All Leads page — one row per lead, the
 * same `AllLeadRow` the board renders, so the file can never disagree
 * with the page about who a lead is or where it came from.
 *
 * One column list drives both outputs: the .xlsx (what Google Sheets
 * imports cleanly — real dates, a numeric rating) and the .csv. Every
 * column is one plain value. A column a source has no field for stays
 * in the sheet and reads blank on that source's rows, so the columns
 * line up whichever sources are in the export:
 *
 *   - "How They Heard" — only the website inquiry form asks.
 *   - "Recreation Center" — TASCO sign-ups only.
 *   - "Camp Attendance" — summer-camp rows only.
 *   - "Parent Name" — the TASCO form never collects one.
 *   - "About the Student" — inquiry + camp forms only.
 *
 * Folded duplicates (lib/lead-links.ts) are not rows of their own —
 * the caller passes primaries only, exactly as the board shows them —
 * and "Also Signed Up Via" names the sources folded under each one.
 */

const SOURCE_LABEL: Record<LeadSource, string> = {
  inquiry: "Inquiry",
  camp: "Summer Camp",
  visit: "Liability Waiver Visit",
  tasco: "TASCO",
};

/** The lead's own Status-menu value. "" is the working pipeline;
 *  "converted" is the legacy hand-marked win on old inquiries. */
const STATUS_LABEL: Record<string, string> = {
  "": "Active",
  not_interested: "Not interested",
  archived: "Archived",
  converted: "Converted",
};

/** How far the linked family has got — blank until a lead converts. */
const STAGE_LABEL: Record<LeadFunnelStage, string> = {
  "": "",
  linked: "Linked to family",
  started: "Application started",
  applied: "Applied",
  accepted: "Accepted",
  enrolled: "Enrolled",
};

/** Same vocabulary as the board's Tour column. */
const TOUR_LABEL: Record<string, string> = {
  completed: "Toured",
  scheduled: "Scheduled",
  no_show: "No-show",
  canceled: "Canceled",
};

interface LeadExportColumn {
  label: string;
  /** Sheet column width, in characters. */
  width: number;
  /** "date" cells hold "MM/DD/YYYY" text the .xlsx writer stores as a
   *  real date so the column sorts by date in Sheets; "number" cells
   *  go in as numbers (a blank stays blank). */
  kind?: "date" | "number";
  value: (r: AllLeadRow) => string | number;
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");

/** "(727) 555-1234" for any US number, with or without a leading
 *  country-code 1 — never the "+1 …" form, which a spreadsheet reads
 *  as the start of a formula. Anything else passes through as typed. */
function exportPhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? formatUSPhone(ten) : String(raw ?? "").trim();
}

/** One cell's value. A field missing from the row reads blank rather
 *  than the text "undefined". */
function cellValue(c: LeadExportColumn, r: AllLeadRow): string | number {
  return c.value(r) ?? "";
}

export const LEAD_EXPORT_COLUMNS: LeadExportColumn[] = [
  {
    label: "Submitted",
    width: 13,
    kind: "date",
    value: (r) => formatTimestampUs(r.submitted_ts),
  },
  { label: "Source", width: 22, value: (r) => SOURCE_LABEL[r.source] },
  { label: "Student Name", width: 24, value: (r) => r.student_name },
  { label: "Grade", width: 16, value: (r) => r.grade },
  { label: "Current School", width: 28, value: (r) => r.school },
  { label: "Parent Name", width: 24, value: (r) => r.parent_name },
  { label: "Phone", width: 17, value: (r) => exportPhone(r.phone) },
  { label: "Email", width: 30, value: (r) => r.email },
  { label: "How They Heard", width: 28, value: (r) => r.heard_from },
  {
    // The feed's `detail` is the rec center on TASCO rows.
    label: "Recreation Center",
    width: 28,
    value: (r) => (r.source === "tasco" ? r.detail : ""),
  },
  {
    // The consent box on each form. Camp has no box — signing up is
    // the consent the texting layer relies on — so it says so rather
    // than claiming a "Yes" nobody ticked.
    label: "Text Opt-In",
    width: 13,
    value: (r) => (r.source === "camp" ? "Implied" : yesNo(r.opt_in)),
  },
  { label: "Year Interested", width: 16, value: (r) => r.school_year_name },
  {
    label: "Status",
    width: 15,
    value: (r) => STATUS_LABEL[r.lead_status] ?? r.lead_status,
  },
  {
    // The column keeps its old text after a restore, so it only means
    // something while the lead is declined or archived.
    label: "Status Reason",
    width: 28,
    value: (r) =>
      r.lead_status === "not_interested" || r.lead_status === "archived"
        ? r.status_reason
        : "",
  },
  {
    label: "Rating",
    width: 9,
    kind: "number",
    value: (r) => (r.rating > 0 ? r.rating : ""),
  },
  { label: "Followed Up", width: 13, value: (r) => yesNo(r.followed_up) },
  {
    label: "Last Contact",
    width: 14,
    kind: "date",
    value: (r) => formatTimestampUs(r.last_reach_out),
  },
  {
    label: "Tour",
    width: 12,
    value: (r) => TOUR_LABEL[r.tour_status] ?? "",
  },
  {
    label: "Tour Date",
    width: 13,
    kind: "date",
    value: (r) => (r.tour_status ? formatTimestampUs(r.tour_at) : ""),
  },
  {
    label: "Application Stage",
    width: 20,
    value: (r) => STAGE_LABEL[r.funnel_stage] ?? "",
  },
  {
    label: "Converted Family",
    width: 24,
    value: (r) => r.converted_family_name,
  },
  {
    label: "Converted Date",
    width: 16,
    kind: "date",
    value: (r) =>
      r.converted_family_id > 0 ? formatTimestampUs(r.converted_at) : "",
  },
  {
    // The feed's `detail` is attendance on camp rows.
    label: "Camp Attendance",
    width: 17,
    value: (r) => (r.source === "camp" ? r.detail : ""),
  },
  {
    label: "Also Signed Up Via",
    width: 24,
    value: (r) =>
      [...new Set(r.linked_leads.map((l) => SOURCE_LABEL[l.source]))].join(
        ", "
      ),
  },
  { label: "About the Student", width: 40, value: (r) => r.about_student },
];

export type LeadExportFormat = "xlsx" | "csv";

/** Today's date at the school, "YYYY-MM-DD", for the file name. */
function todayStamp(): string {
  const [month, day, year] = formatTimestampUs(Date.now()).split("/");
  return `${year}-${month}-${day}`;
}

/**
 * Download `rows` as a dated spreadsheet. `scope` tags the file name
 * ("current-view", "all") so two exports side by side are tellable
 * apart. Browser-only.
 */
export async function exportLeads({
  rows,
  format,
  scope,
}: {
  rows: AllLeadRow[];
  format: LeadExportFormat;
  scope: string;
}): Promise<void> {
  const safeScope =
    scope.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-|-$/g, "") || "export";
  const filename = `leads-${safeScope}-${todayStamp()}.${format}`;
  if (format === "csv") {
    downloadTextFile(filename, buildLeadsCsv(rows), "text/csv;charset=utf-8;");
    return;
  }
  await downloadLeadsXlsx(rows, filename);
}

/**
 * Lead names, schools and the "about" / "how they heard" answers are
 * typed into public forms, and a spreadsheet runs any CSV cell that
 * starts with `=`, `+`, `-` or `@` as a formula. A leading apostrophe
 * makes Sheets and Excel read the cell as text. (The .xlsx needs no
 * guard: its cells are written as typed strings, never formulas.)
 */
function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function buildLeadsCsv(rows: AllLeadRow[]): string {
  return buildCsv(
    LEAD_EXPORT_COLUMNS.map((c) => ({
      label: c.label,
      value: (r: AllLeadRow) => csvSafe(String(cellValue(c, r))),
    })),
    rows
  );
}

/** `exceljs` is dynamically imported so its weight only ships when an
 *  admin actually exports (same pattern as `lib/pipeline-export.ts`). */
async function downloadLeadsXlsx(
  rows: AllLeadRow[],
  filename: string
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SailFuture Apply";
  const sheet = workbook.addWorksheet("Leads");
  const columns = LEAD_EXPORT_COLUMNS;

  sheet.columns = columns.map((c, i) => ({
    header: c.label,
    key: `c${i}`,
    width: c.width,
  }));

  for (const row of rows) {
    sheet.addRow(
      columns.map((c) => {
        const value = cellValue(c, row);
        // A truly empty cell, not an empty string, so blanks sort and
        // filter as blanks in date and number columns.
        if (value === "") return null;
        // Real Excel dates, so the column sorts and filters by date.
        if (c.kind === "date" && typeof value === "string") {
          return parseDateUs(value) ?? value;
        }
        return value;
      })
    );
  }
  // Shown month-first, like every date in the app.
  columns.forEach((c, i) => {
    if (c.kind === "date") sheet.getColumn(i + 1).numFmt = "mm/dd/yyyy";
  });

  // Bold + frozen header row, with a filter across the columns so the
  // sheet can be sorted and filtered the moment it opens.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
