/**
 * Student school-account handout — a printable, one-page-per-student
 * PDF carrying the student's name, school Google email, and password,
 * for handing out on the first day of classes.
 *
 * Deliberately designed for a BLACK-AND-WHITE laser printer: no color
 * fills, no light-on-light tints, no thin hairlines. Everything is
 * black text, gray rules, and the navy brand mark (which prints as a
 * solid dark block with the white knot reversed out of it). The one
 * exception is the laptop liability copy, which is bold red at the
 * school's request — a deep red that still prints as a dark gray, with
 * the bold weight doing the emphasis work on a mono printer. The
 * credentials themselves are set in Courier — a monospaced face makes
 * the ambiguous characters a student has to retype (1/l, 0/O) legible
 * on a photocopy, which Helvetica does not.
 *
 * Server-side (Node) so the brand mark can be read off disk the same
 * way `records-request-pdf.ts` does it. One `addPage()` per student
 * after the first — every page is a fixed layout that cannot overflow,
 * so there is no flowing/pagination logic to get wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CredentialCardStudent {
  firstName: string;
  lastName: string;
  /** Admin-assigned grade level ("9th"). Empty renders as no grade. */
  gradeLevel: string;
  /** Admin-assigned crew ("Crew B"). Empty renders as no crew. */
  crew: string;
  /** Stored `school_email` — never regenerated here. */
  email: string;
  /** Stored `school_password` — never regenerated here. */
  password: string;
}

// US Letter in points (jsPDF "pt" unit).
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BLACK: [number, number, number] = [0, 0, 0];
const GRAY: [number, number, number] = [105, 105, 105];
const RULE: [number, number, number] = [190, 190, 190];
const BOX_BORDER: [number, number, number] = [60, 60, 60];
/** The one non-grayscale ink on the page — the laptop liability
 *  sentences. Deliberately a deep red (not a bright one) so it still
 *  prints as a dark gray on a black-and-white printer; the bold weight
 *  is what carries the emphasis there. */
const RED: [number, number, number] = [176, 27, 27];

/** cp1252 repertoire — jsPDF's built-in fonts are PDF standard fonts
 *  and can only encode WinAnsi. Anything outside it draws as garbage
 *  bytes AND measures wrong, so student names out of Xano get mapped
 *  down before they reach the page. Same guard as `lib/family-pdf.ts`;
 *  kept local because this module draws no tables. */
const WINANSI_OK =
  /[\t\n\r\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

function pdfSafe(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "→") {
      out += "->";
      continue;
    }
    if (ch === " " || ch === " " || ch === " ") {
      out += " ";
      continue;
    }
    out += WINANSI_OK.test(ch) ? ch : "?";
  }
  return out;
}

/** Memoized brand mark, read off disk as a base64 data URL.
 *
 *  `logo-print.jpg` (256px) is preferred over the 900px `logo.jpg`
 *  every other surface uses: the mark draws at 52pt here, so 256px is
 *  still ~350 dpi on paper, and the JPEG bytes get embedded in EVERY
 *  generated PDF. The crew export writes one file per student plus one
 *  per crew, so the full-size mark alone would push a 120-student zip
 *  past 10 MB — with the print mark it lands near 2 MB.
 *
 *  Falls back to the full-size mark, then to a text-only header, so a
 *  missing asset degrades instead of failing the export. Cached because
 *  the generator runs once per student: `undefined` = not attempted
 *  yet, `null` = attempted and unavailable. */
let logoCache: string | null | undefined;
function loadLogoDataUrl(): string | null {
  if (logoCache !== undefined) return logoCache;
  for (const file of ["logo-print.jpg", "logo.jpg"]) {
    try {
      const buf = readFileSync(join(process.cwd(), "public", file));
      logoCache = `data:image/jpeg;base64,${buf.toString("base64")}`;
      return logoCache;
    } catch {
      // Try the next candidate.
    }
  }
  logoCache = null;
  return logoCache;
}

export interface CredentialCardOptions {
  /** School-year label for the header ("2026-2027"). */
  yearName: string;
  /** Printed-on stamp for the footer. Defaults to now. */
  printedOn?: Date;
}

/**
 * Build the handout. Students are drawn in the order given — the
 * caller sorts (crew, then last name) so a crew's stack comes off the
 * printer ready to hand out.
 */
export async function generateStudentCredentialPdf(
  students: CredentialCardStudent[],
  options: CredentialCardOptions
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setProperties({
    title: `Student Sign-In Sheets - ${options.yearName}`,
  });

  const logo = loadLogoDataUrl();
  const printed = (options.printedOn ?? new Date()).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" }
  );

  /** Draw `text` at the largest size <= `startSize` that still fits
   *  `maxWidth`, never going below `minSize` (past which it is left
   *  to overflow rather than becoming unreadable). Returns nothing —
   *  the caller has already positioned the cursor. */
  function drawFitted(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    startSize: number,
    minSize: number
  ) {
    let size = startSize;
    doc.setFontSize(size);
    while (size > minSize && doc.getTextWidth(text) > maxWidth) {
      size -= 0.5;
      doc.setFontSize(size);
    }
    doc.text(text, x, y);
  }

  students.forEach((student, index) => {
    if (index > 0) doc.addPage();

    const fullName =
      pdfSafe(`${student.firstName} ${student.lastName}`.trim()) || "Student";
    const grade = pdfSafe(student.gradeLevel.trim());
    // Crew values are self-labeling ("Crew B"), so they print as
    // stored rather than gaining a redundant "Crew " prefix.
    const crew = pdfSafe(student.crew.trim());

    /* ── Letterhead ──────────────────────────────────────────────
       Brand mark left, org name + document title beside it, school
       year right-aligned on the same baseline as the title. */
    const headerTop = 48;
    const LOGO = 52;
    if (logo) {
      try {
        doc.addImage(logo, "JPEG", MARGIN, headerTop, LOGO, LOGO);
      } catch {
        // Non-fatal — the text header below still identifies the page.
      }
    }
    const headX = logo ? MARGIN + LOGO + 16 : MARGIN;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...BLACK);
    doc.text("SailFuture Academy", headX, headerTop + 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...GRAY);
    doc.text("Student Account Sign-In", headX, headerTop + 40);
    doc.text(
      pdfSafe(`${options.yearName} School Year`),
      PAGE_W - MARGIN,
      headerTop + 40,
      { align: "right" }
    );

    let y = headerTop + LOGO + 18;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(1);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);

    /* ── Student ────────────────────────────────────────────────
       The name is set large so a stack of these can be flipped
       through and handed out by sight, with the crew boxed at the
       right edge — the unit staff actually sort the stack into, so it
       reads from across a table without hunting for a line of text. */
    y += 52;

    let nameMaxW = CONTENT_W;
    if (crew) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      const badgeText = crew.toUpperCase();
      const badgeW = doc.getTextWidth(badgeText) + 30;
      const badgeH = 32;
      const badgeX = PAGE_W - MARGIN - badgeW;
      const badgeY = y - 24;
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(1.5);
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 5, 5, "S");
      doc.setTextColor(...BLACK);
      doc.text(badgeText, badgeX + badgeW / 2, badgeY + 21, {
        align: "center",
      });
      // The name shrinks to clear the badge rather than running under
      // it — a 40-character hyphenated name must not collide.
      nameMaxW = CONTENT_W - badgeW - 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLACK);
    drawFitted(fullName, MARGIN, y, nameMaxW, 30, 15);

    // Grade under the name; the crew sits in the badge above. Both are
    // set after acceptance, so either can still be blank — the line
    // falls back to a plain descriptor when neither exists.
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...GRAY);
    doc.text(
      grade
        ? `${grade} Grade`
        : crew
          ? "SailFuture Academy"
          : "SailFuture Academy student",
      MARGIN,
      y
    );

    /* ── Credentials ────────────────────────────────────────────
       Two heavy-bordered boxes; label in small caps, value in
       monospace so retyping it off a photocopy is unambiguous. */
    const BOX_H = 88;
    const BOX_PAD = 18;

    function credentialBox(top: number, label: string, value: string) {
      doc.setDrawColor(...BOX_BORDER);
      doc.setLineWidth(1.2);
      doc.roundedRect(MARGIN, top, CONTENT_W, BOX_H, 6, 6, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text(label, MARGIN + BOX_PAD, top + 26);

      doc.setFont("courier", "bold");
      doc.setTextColor(...BLACK);
      drawFitted(
        pdfSafe(value),
        MARGIN + BOX_PAD,
        top + 62,
        CONTENT_W - BOX_PAD * 2,
        20,
        9
      );
    }

    y += 26;
    credentialBox(y, "SCHOOL EMAIL", student.email);
    y += BOX_H + 16;
    credentialBox(y, "PASSWORD", student.password);
    y += BOX_H + 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...GRAY);
    doc.text(
      "Type both exactly as printed. Capital letters, lowercase letters, and punctuation all matter.",
      MARGIN,
      y
    );

    /* ── Instructions ───────────────────────────────────────────── */
    y += 30;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text("HOW TO SIGN IN", MARGIN, y);

    y += 8;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.8);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 20;

    const STEPS = [
      "Open your school laptop. This is the account that signs you in to it.",
      "Enter the school email printed above and click Next.",
      "Enter the password printed above and click Next.",
      "If Google asks you to agree to its terms, read them and click Accept.",
      'The same email and password sign you in to Gmail, Google Drive, Classroom, and anything else at school that asks you to "Sign in with Google."',
    ];
    const STEP_INDENT = 22;
    const STEP_LINE = 16;
    doc.setFontSize(11);
    STEPS.forEach((step, i) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BLACK);
      doc.text(`${i + 1}.`, MARGIN, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(
        pdfSafe(step),
        CONTENT_W - STEP_INDENT
      ) as string[];
      doc.text(lines, MARGIN + STEP_INDENT, y);
      y += lines.length * STEP_LINE + 6;
    });

    /* ── Laptop responsibility ────────────────────────────────────
       Two registers: a plain lead-in, then the liability itself in
       bold red. The red is a deep tone rather than a bright one so it
       still renders as a dark gray on the black-and-white printer
       these pages are meant for — bold carries the emphasis there. */
    const FOOTER_Y = PAGE_H - 42;
    const NOTE_LINE = 14;
    const NOTE_W = CONTENT_W - BOX_PAD * 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const leadLines = doc.splitTextToSize(
      pdfSafe("This account signs you in to the school laptop assigned to you."),
      NOTE_W
    ) as string[];

    doc.setFont("helvetica", "bold");
    const warnLines = doc.splitTextToSize(
      pdfSafe(
        "That laptop is issued to you and to no one else, and you are responsible for returning it in proper working condition. A laptop that is not returned, or is returned damaged, must be repaired or replaced at you and your family's expense."
      ),
      NOTE_W
    ) as string[];

    // Box hugs its copy, then bottom-anchors just above the footer so
    // the page stays balanced whatever the text length. The `max`
    // keeps it below the steps if that copy ever grows into it.
    const noteH =
      34 + (leadLines.length + warnLines.length) * NOTE_LINE + 6 + 12;
    const noteTop = Math.max(y + 12, FOOTER_Y - 26 - noteH);

    doc.setDrawColor(...BOX_BORDER);
    doc.setLineWidth(1);
    doc.roundedRect(MARGIN, noteTop, CONTENT_W, noteH, 6, 6, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("YOUR SCHOOL LAPTOP", MARGIN + BOX_PAD, noteTop + 20);

    let noteY = noteTop + 38;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...BLACK);
    doc.text(leadLines, MARGIN + BOX_PAD, noteY);
    noteY += leadLines.length * NOTE_LINE + 6;

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...RED);
    doc.text(warnLines, MARGIN + BOX_PAD, noteY);

    /* ── Footer ─────────────────────────────────────────────────── */
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(
      pdfSafe(
        `SailFuture Academy  ${"·"}  2154 27th Ave N, St. Petersburg, FL 33713  ${"·"}  Printed ${printed}`
      ),
      PAGE_W / 2,
      FOOTER_Y,
      { align: "center" }
    );
  });

  const bytes = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(bytes);
}
