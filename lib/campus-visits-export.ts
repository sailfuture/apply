import type { CampusVisitRow } from "@/app/api/admin/campus-visits/route";
import { formatUSPhone } from "@/lib/phone";
import {
  copyTableToClipboard,
  downloadCsv,
  type ExportColumn,
} from "@/lib/table-export";

/**
 * CSV export + clipboard copy for the admin Campus Visits table.
 *
 * Deliberately wider than the on-screen table: the rendered grid trims
 * email, academic year and the signature link to keep rows single-line,
 * but an export is expected to carry everything on the record. The
 * generic builders in `lib/table-export.ts` turn this one column list
 * into the CSV, the TSV clipboard payload and the HTML table, so the
 * three can never drift apart.
 */

const COLUMNS: ExportColumn<CampusVisitRow>[] = [
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

/** Download the given rows as a dated .csv. `scope` tags the filename
 *  (the selected academic year, or "all-years"). */
export function downloadCampusVisitsCsv(
  rows: CampusVisitRow[],
  scope: string
): void {
  downloadCsv(COLUMNS, rows, "campus-visits", scope);
}

/** Copy the rows to the clipboard as TSV + an HTML table. */
export async function copyCampusVisitsTable(
  rows: CampusVisitRow[]
): Promise<void> {
  await copyTableToClipboard(COLUMNS, rows);
}
