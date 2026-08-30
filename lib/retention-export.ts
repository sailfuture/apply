import type { RetentionUnenrolledRow } from "@/app/api/admin/retention/route";

/**
 * Retention report exports — XLSX and PDF versions of the
 * /admin/retention page, mirroring exactly what the page shows for
 * the selected segment: the headline numbers, the counted departures,
 * and the "not counted" (retention-exempt) departures in their own
 * section.
 *
 * Browser-only: `exceljs` / `jspdf` are dynamically imported so their
 * weight only ships when admin actually exports (same pattern as
 * `billing-export.ts` / `family-pdf.ts`).
 */

export interface RetentionExportInput {
  /** Display name of the school year ("2026-2027"); "" falls back to
   *  a plain "Retention" title. */
  yearName: string;
  /** Segment the page is filtered to — labels the export so a
   *  community-only file can't be misread as school-wide. */
  segmentLabel: string;
  enrolledCount: number;
  /** Counted departures, split the way the page splits them —
   *  residential/foster placements churn by design, so they're
   *  reported separately from community departures. */
  communityCounted: RetentionUnenrolledRow[];
  residentialCounted: RetentionUnenrolledRow[];
  /** Currently-enrolled counts per group, for the per-group rates. */
  communityEnrolled: number;
  residentialEnrolled: number;
  /** Retention-exempt departures (never really enrolled), page order. */
  notCounted: RetentionUnenrolledRow[];
  /** Pre-formatted rate ("94.2%" / "—") — computed on the page so the
   *  export can never disagree with the screen. */
  ratePct: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Retention rate for a group — mirrors the page's `formatRate`. */
function rate(enrolled: number, departures: number): string {
  const total = enrolled + departures;
  if (total <= 0) return "—";
  return `${((enrolled / total) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function fileStem(input: RetentionExportInput): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = input.yearName
    ? `-${input.yearName.replace(/[^\w-]+/g, "-")}`
    : "";
  const segPart =
    input.segmentLabel && input.segmentLabel !== "All"
      ? `-${input.segmentLabel.toLowerCase()}`
      : "";
  return `retention${yearPart}${segPart}-${stamp}`;
}

const ROSTER_COLUMNS: Array<{
  label: string;
  width: number;
  value: (r: RetentionUnenrolledRow) => string;
}> = [
  { label: "Student", width: 24, value: (r) => r.student_name },
  { label: "Grade", width: 8, value: (r) => r.grade },
  { label: "Family", width: 24, value: (r) => r.family_name },
  {
    label: "Type",
    width: 12,
    value: (r) => (r.residential ? "Residential" : "Community"),
  },
  { label: "Unenrolled", width: 14, value: (r) => fmtDate(r.date) },
  { label: "Reason", width: 40, value: (r) => r.reason },
  { label: "Notes", width: 44, value: (r) => r.notes },
  {
    label: "Counted",
    width: 10,
    value: (r) => (r.retention_exempt ? "No" : "Yes"),
  },
];

/** Two-sheet workbook: a Summary sheet with the headline numbers and
 *  an Unenrolled Students roster (counted rows first, not-counted at
 *  the bottom, flagged in the Counted column) with a frozen header +
 *  autofilter for immediate sorting in Excel. */
export async function exportRetentionXlsx(
  input: RetentionExportInput
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SailFuture Apply";

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 26 }, { width: 18 }];
  const summaryRows: Array<[string, string | number]> = [
    [
      "Retention report",
      input.yearName ? `${input.yearName} school year` : "",
    ],
    ["Segment", input.segmentLabel],
    ["Generated", new Date().toLocaleDateString("en-US")],
    ["", ""],
    ["Enrolled", input.enrolledCount],
    [
      "Unenrolled (counted)",
      input.communityCounted.length + input.residentialCounted.length,
    ],
    ["Not counted (never attended)", input.notCounted.length],
    ["Retention rate", input.ratePct],
    ["", ""],
    ["Community enrolled", input.communityEnrolled],
    ["Community unenrolled", input.communityCounted.length],
    [
      "Community retention",
      rate(input.communityEnrolled, input.communityCounted.length),
    ],
    ["", ""],
    ["Residential enrolled", input.residentialEnrolled],
    ["Residential unenrolled", input.residentialCounted.length],
    [
      "Residential retention",
      rate(input.residentialEnrolled, input.residentialCounted.length),
    ],
  ];
  for (const [label, value] of summaryRows) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  const sheet = workbook.addWorksheet("Unenrolled Students");
  sheet.columns = ROSTER_COLUMNS.map((c) => ({
    header: c.label,
    key: c.label,
    width: c.width,
  }));
  for (const r of [
    ...input.communityCounted,
    ...input.residentialCounted,
    ...input.notCounted,
  ]) {
    const row = sheet.addRow(
      Object.fromEntries(ROSTER_COLUMNS.map((c) => [c.label, c.value(r)]))
    );
    if (r.retention_exempt) {
      row.font = { color: { argb: "FF888888" } };
    }
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ROSTER_COLUMNS.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileStem(input)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click can kick off the download
  // before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Letter-portrait PDF: headline numbers up top, then the counted
 *  departures table, then a separate "Not counted" table. autoTable
 *  handles page breaks; no manual addPage calls. */
export async function exportRetentionPdf(
  input: RetentionExportInput
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(
    input.yearName ? `Retention - ${input.yearName}` : "Retention",
    margin,
    y
  );
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `${input.segmentLabel} segment - generated ${new Date().toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric", year: "numeric" }
    )}`,
    margin,
    y
  );
  doc.setTextColor(0);
  y += 16;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Enrolled", "Unenrolled (counted)", "Not counted", "Retention rate"]],
    body: [
      [
        String(input.enrolledCount),
        String(
          input.communityCounted.length + input.residentialCounted.length
        ),
        String(input.notCounted.length),
        input.ratePct,
      ],
    ],
    styles: { fontSize: 11, halign: "center", cellPadding: 6 },
    headStyles: { fillColor: [40, 40, 40], fontSize: 8 },
    margin: { left: margin, right: margin },
  });

  const rosterHead = [
    ["Student", "Grade", "Family", "Unenrolled", "Reason", "Notes"],
  ];
  const rosterRow = (r: RetentionUnenrolledRow) => [
    r.student_name,
    r.grade || "-",
    r.residential ? `${r.family_name} (Residential)` : r.family_name,
    fmtDate(r.date) || "-",
    r.reason || "-",
    r.notes || "-",
  ];
  const rosterStyles = {
    styles: { fontSize: 8, cellPadding: 4, valign: "top" as const },
    headStyles: { fillColor: [40, 40, 40] as [number, number, number], fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 34 },
      2: { cellWidth: 100 },
      3: { cellWidth: 58 },
    },
    margin: { left: margin, right: margin },
  };

  type DocWithAutoTable = typeof doc & { lastAutoTable?: { finalY: number } };
  const lastY = () => (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y;

  /** One titled roster section. Community and residential are
   *  reported separately (residential placements churn by design), so
   *  each carries its own count + retention rate in the heading. */
  function section(
    heading: string,
    rows: RetentionUnenrolledRow[],
    emptyText: string,
    muted = false
  ): void {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(heading, margin, lastY() + 26);
    autoTable(doc, {
      startY: lastY() + 32,
      head: rosterHead,
      body: rows.length
        ? rows.map(rosterRow)
        : [[emptyText, "", "", "", "", ""]],
      ...rosterStyles,
      ...(muted
        ? {
            styles: {
              ...rosterStyles.styles,
              textColor: [120, 120, 120] as [number, number, number],
            },
          }
        : {}),
    });
  }

  if (input.segmentLabel !== "Residential") {
    section(
      `Community students - ${input.communityCounted.length} unenrolled, ${rate(
        input.communityEnrolled,
        input.communityCounted.length
      )} retained`,
      input.communityCounted,
      "No community departures."
    );
  }

  if (input.segmentLabel !== "Community") {
    section(
      `Residential students - ${
        input.residentialCounted.length
      } unenrolled, ${rate(
        input.residentialEnrolled,
        input.residentialCounted.length
      )} retained`,
      input.residentialCounted,
      "No residential departures."
    );
  }

  if (input.notCounted.length > 0) {
    section(
      `Not counted - never attended (${input.notCounted.length})`,
      input.notCounted,
      "",
      true
    );
  }

  doc.save(`${fileStem(input)}.pdf`);
}
