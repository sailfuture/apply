import type { XanoSummerCampInquiry } from "./xano";

/**
 * Build and download an .xlsx of summer-camp registrations. Browser-
 * only — `exceljs` is dynamically imported so its weight only ships
 * when admin actually exports (same pattern as `enrolled-export.ts`).
 * Exports every field on the record, both attending and not-attending
 * rows, with an Attending column so staff can filter in Excel.
 */

const COLUMNS: Array<{
  label: string;
  value: (r: XanoSummerCampInquiry) => string;
}> = [
  { label: "Student First Name", value: (r) => r.student_first_name ?? "" },
  { label: "Student Last Name", value: (r) => r.student_last_name ?? "" },
  {
    label: "Attending",
    value: (r) => (r.isNotAttending ? "No" : "Yes"),
  },
  { label: "Gender", value: (r) => r.gender ?? "" },
  { label: "Ethnicity", value: (r) => r.ethnicity ?? "" },
  {
    label: "Last Grade Completed",
    value: (r) => r.last_grade_completed ?? "",
  },
  { label: "Current School", value: (r) => r.current_school ?? "" },
  { label: "Swim Level", value: (r) => r.swim_level ?? "" },
  { label: "Transportation", value: (r) => r.transportation ?? "" },
  { label: "Bus Stop", value: (r) => r.bus_stop ?? "" },
  {
    label: "About the Student",
    value: (r) => r.describe_your_student_and_behavior ?? "",
  },
  { label: "Allergies", value: (r) => r.allergies ?? "" },
  {
    label: "Dietary Restrictions",
    value: (r) => r.dietary_restrictions ?? "",
  },
  { label: "Health Conditions", value: (r) => r.health_conditions ?? "" },
  {
    label: "Hearing / Visual Impairments",
    value: (r) => r.hearing_or_visual_impairments ?? "",
  },
  {
    label: "Additional Health Info",
    value: (r) => r.additional_health_information ?? "",
  },
  {
    label: "Carries EpiPen",
    value: (r) => (r.carry_epi_pen ? "Yes" : "No"),
  },
  { label: "Preferred Hospital", value: (r) => r.preferred_hospital ?? "" },
  {
    label: "Parent First Name",
    value: (r) => r.primary_parent_first_name ?? "",
  },
  {
    label: "Parent Last Name",
    value: (r) => r.primary_parent_last_name ?? "",
  },
  {
    label: "Parent Relationship",
    value: (r) => r.primary_parent_relationship ?? "",
  },
  { label: "Parent Phone", value: (r) => String(r.primary_phone ?? "") },
  { label: "Parent Email", value: (r) => r.primary_email ?? "" },
  {
    label: "Submitted",
    value: (r) =>
      r.created_at ? new Date(r.created_at).toLocaleString() : "",
  },
];

export async function exportSummerCampXlsx(
  rows: XanoSummerCampInquiry[]
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SailFuture Apply";
  const sheet = workbook.addWorksheet("Summer Camp");

  sheet.columns = COLUMNS.map((c) => ({
    header: c.label,
    key: c.label,
    width: Math.min(40, Math.max(12, c.label.length + 4)),
  }));

  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(COLUMNS.map((c) => [c.label, c.value(row)]))
    );
  }

  // Bold + frozen header with an autofilter so staff can sort/filter
  // the roster in Excel immediately.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `summer-camp-registrations-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click can kick off the download
  // before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
