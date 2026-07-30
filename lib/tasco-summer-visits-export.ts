import type { TascoSummerVisitRow } from "@/app/api/admin/tasco-summer-visits/route";
import { formatUSPhone } from "@/lib/phone";
import {
  copyTableToClipboard,
  downloadCsv,
  type ExportColumn,
} from "@/lib/table-export";

/**
 * CSV export + clipboard copy for the admin TASCO Summer Visits table.
 *
 * Carries the raw recreation-center string alongside the normalized
 * one: the table shows the canonical name so a center isn't split
 * across spellings, but the export keeps what the signer actually
 * wrote so nothing is silently rewritten. Shares the generic builders
 * in `lib/table-export.ts` with the other admin list exports.
 */

const COLUMNS: ExportColumn<TascoSummerVisitRow>[] = [
  {
    label: "Submitted",
    value: (r) =>
      r.submitted_ts ? new Date(r.submitted_ts).toLocaleString() : "",
  },
  { label: "Student Name", value: (r) => r.student_name ?? "" },
  { label: "Current Grade", value: (r) => r.current_grade ?? "" },
  { label: "Current School", value: (r) => r.current_school ?? "" },
  { label: "Recreation Center", value: (r) => r.recreation_center ?? "" },
  {
    label: "Recreation Center (as entered)",
    value: (r) => r.recreation_center_raw ?? "",
  },
  {
    label: "Parent Phone",
    value: (r) =>
      r.parent_phone ? formatUSPhone(r.parent_phone) || r.parent_phone : "",
  },
  { label: "Parent Email", value: (r) => r.parent_email ?? "" },
  {
    label: "Marketing Opt-In",
    value: (r) => (r.marketing_opt_in ? "Yes" : "No"),
  },
];

/** Download the given rows as a dated .csv. `scope` tags the filename
 *  (the selected recreation center, or "all-centers"). */
export function downloadTascoSummerVisitsCsv(
  rows: TascoSummerVisitRow[],
  scope: string
): void {
  downloadCsv(COLUMNS, rows, "tasco-summer-visits", scope);
}

/** Copy the rows to the clipboard as TSV + an HTML table. */
export async function copyTascoSummerVisitsTable(
  rows: TascoSummerVisitRow[]
): Promise<void> {
  await copyTableToClipboard(COLUMNS, rows);
}
