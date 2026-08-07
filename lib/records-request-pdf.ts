/**
 * Records-request letter PDF — server-side generation.
 *
 * Builds the formal "please transfer this student's records" letter
 * SailFuture sends to a newly-enrolled student's previous school. Runs
 * server-side (in the records-request API route) so the exact same
 * bytes can be both previewed inline in the compose dialog AND attached
 * to the outgoing Resend email — no client/server duplication of the
 * letter.
 *
 * The wording is fixed (matching the approved letter); only the five
 * variable fields below are interpolated. The requested-records list,
 * contact line, and signature block are constant.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RecordsRequestFields {
  /** Full student name, e.g. "Charlee Howard". */
  studentName: string;
  /** Date of birth as a display string, e.g. "11/09/2012". */
  dateOfBirth: string;
  /** Previous school name, e.g. "Our Savior Lutheran School". */
  previousSchool: string;
  /** Enrollment effective date, e.g. "08/25/2025". */
  effectiveDate: string;
  /** Academic year label, e.g. "2025". */
  academicYear: string;
}

/** Records we ask every previous school to transfer. Fixed list —
 *  matches the approved letter. */
const REQUESTED_RECORDS = [
  "Transcripts for all completed courses",
  "Standardized test scores",
  "Attendance records",
  "Any Individualized Education Plans (IEPs) or 504 Plans",
  "Disciplinary records, if applicable",
  "Copy of Birth Certificate",
  "Copy of Immunization Records",
];

// US Letter in points (jsPDF "pt" unit).
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_SIZE = 11;
const LINE = 16;
const BRAND_NAVY: [number, number, number] = [15, 42, 74]; // #0F2A4A

/** Read the brand mark off disk as a base64 data URL for the
 *  letterhead. Best-effort — if the file is missing or unreadable the
 *  letter falls back to a text-only letterhead rather than failing the
 *  whole send. */
function loadLogoDataUrl(): string | null {
  try {
    const buf = readFileSync(join(process.cwd(), "public", "logo.jpg"));
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function generateRecordsRequestPdf(
  fields: RecordsRequestFields
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setProperties({
    title: `Records Request — ${fields.studentName}`,
  });

  // Running vertical cursor; every writer below advances it.
  let y = MARGIN;

  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  /** Wrapped paragraph + a trailing blank line. */
  function paragraph(text: string) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    ensureSpace(lines.length * LINE);
    doc.text(lines, MARGIN, y);
    y += lines.length * LINE + LINE;
  }

  /** Single unwrapped line, no trailing gap. */
  function textLine(text: string) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(0, 0, 0);
    ensureSpace(LINE);
    doc.text(text, MARGIN, y);
    y += LINE;
  }

  /** Bold label + normal value on one line ("Student Name: Charlee"). */
  function labeledLine(label: string, value: string) {
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(0, 0, 0);
    ensureSpace(LINE);
    doc.setFont("helvetica", "bold");
    doc.text(label, MARGIN, y);
    const labelW = doc.getTextWidth(`${label} `);
    doc.setFont("helvetica", "normal");
    doc.text(value, MARGIN + labelW, y);
    y += LINE;
  }

  /** Bulleted item with a hanging indent so wrapped lines align. */
  function bullet(text: string) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(0, 0, 0);
    const indent = 16;
    const lines = doc.splitTextToSize(text, CONTENT_W - indent) as string[];
    ensureSpace(lines.length * LINE);
    doc.text("•", MARGIN, y);
    doc.text(lines, MARGIN + indent, y);
    y += lines.length * LINE;
  }

  function gap(n = LINE) {
    y += n;
  }

  // ── Letterhead ──────────────────────────────────────────────────
  const logo = loadLogoDataUrl();
  const headerTop = y;
  if (logo) {
    try {
      doc.addImage(logo, "JPEG", MARGIN, headerTop, 46, 46);
    } catch {
      // Non-fatal — fall through to the text-only letterhead.
    }
  }
  const headX = logo ? MARGIN + 60 : MARGIN;
  const HEAD_LINE = 13;
  let hy = headerTop + 11; // first baseline

  // Org name — bold navy, but the same 10pt size as the address lines.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_NAVY);
  doc.text("SailFuture Academy", headX, hy);
  hy += HEAD_LINE;

  // Address + contact — normal weight, gray, same size.
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  for (const line of [
    "2154 27th Ave N",
    "St. Petersburg, FL 33713",
    "admissions@sailfuture.org",
    "https://sailfutureacademy.org",
  ]) {
    doc.text(line, headX, hy);
    hy += HEAD_LINE;
  }
  doc.setTextColor(0, 0, 0);

  // Rule sits below whichever is taller — the logo or the text block.
  y = Math.max(headerTop + (logo ? 46 : 0), hy) + 8;
  doc.setDrawColor(220, 220, 220);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 24;

  // ── Date ────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  textLine(today);
  gap();

  // ── Body ────────────────────────────────────────────────────────
  paragraph("To Whom It May Concern,");
  paragraph(
    `We are writing to inform you that ${fields.studentName} has been enrolled at SailFuture Academy for the ${fields.academicYear} academic year, effective ${fields.effectiveDate}.`
  );
  paragraph(
    "In accordance with educational continuity and compliance with record-keeping regulations, we request the transfer of this student's academic records from your institution to ours."
  );

  labeledLine("Student Name:", fields.studentName);
  labeledLine("Date of Birth:", fields.dateOfBirth);
  labeledLine("Previous School Name:", fields.previousSchool);
  gap();

  textLine("Specifically, we are requesting:");
  gap(6);
  for (const rec of REQUESTED_RECORDS) bullet(rec);
  gap();

  paragraph(
    "Should you require further information to fulfill this request, please contact us at (727) 900-1436, lmanke@sailfuture.org, or dean@sailfuture.org."
  );

  // ── Signature ───────────────────────────────────────────────────
  gap();
  textLine("Laura Manke");
  textLine("Assistant Head of School, SailFuture Academy");
  textLine("lmanke@sailfuture.org");

  const bytes = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(bytes);
}
