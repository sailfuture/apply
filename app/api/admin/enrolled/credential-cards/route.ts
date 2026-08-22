import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  generateStudentCredentialPdf,
  type CredentialCardStudent,
} from "@/lib/student-credential-pdf";

/**
 * Student sign-in sheets — letter-size school-account handouts,
 * printable in black and white and handed out on the first day of
 * classes, delivered as a zip organized BY CREW:
 *
 *   Crew A/
 *     Crew A - 24 students.pdf   ← the crew's whole stack, one print job
 *   Crew B/
 *     ...
 *   No crew assigned/
 *
 *   POST { studentIds: number[], yearId: number }  →  application/zip
 *
 * The client (enrolled roster) sends exactly the students it is
 * showing, so the handout respects whatever filters/search the admin
 * has applied — same contract as the batch IEP download next to it.
 *
 * Credentials are read STRAIGHT off the student row (`school_email` /
 * `school_password`), never regenerated from the name + year here: the
 * stored values are what was actually pushed into Google Workspace, and
 * a student whose account was created under a hand-corrected address
 * must get that address on paper. Students with no stored account are
 * skipped and reported back in the `X-Skipped-Count` header so the
 * caller can tell admin to run "Create Student Emails" first.
 *
 * Crew + grade level come from the year's registration packet (the
 * admin placement fields set on the student detail page).
 */
export const maxDuration = 60;

const MAX_STUDENTS = 400;

/** Folder name for students whose crew hasn't been set yet. Sorts
 *  last because the crew sort key pushes blanks to the end. */
const NO_CREW_FOLDER = "No crew assigned";

/** Strip characters that break zip paths on Windows extractors —
 *  same guard the IEP export uses. */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);

    const rawIds: unknown[] = Array.isArray(body?.studentIds)
      ? body.studentIds
      : [];
    const studentIds = [
      ...new Set(
        rawIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    if (studentIds.length === 0) {
      return NextResponse.json(
        { error: "studentIds is required" },
        { status: 400 }
      );
    }
    if (studentIds.length > MAX_STUDENTS) {
      return NextResponse.json(
        { error: `Too many students in one request (max ${MAX_STUDENTS})` },
        { status: 400 }
      );
    }

    const yearId = Number(body?.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // One bulk read each instead of N per-student round-trips. The
    // packet read is a side lookup for grade level only — a student
    // with no packet still gets a page, just without a grade line.
    const [studentsResult, packetsResult, yearResult] =
      await Promise.allSettled([
        xano.students.getAll(),
        xano.studentRegistration.getAll(),
        xano.schoolYears.getById(yearId),
      ]);

    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled/credential-cards] failed to load students:",
        studentsResult.reason
      );
      return NextResponse.json(
        { error: "Couldn't load students" },
        { status: 502 }
      );
    }
    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled/credential-cards] failed to load packets:",
        packetsResult.reason
      );
    }

    const yearName =
      yearResult.status === "fulfilled"
        ? (yearResult.value?.year_name ?? "").trim()
        : "";

    // Placement (grade + crew) lives on the year's packet, set from
    // the detail page's Placement card. Either can still be blank.
    const gradeByStudent = new Map<number, string>();
    const crewByStudent = new Map<number, string>();
    if (packetsResult.status === "fulfilled") {
      for (const p of packetsResult.value) {
        if (Number(p.registration_school_years_id) !== yearId) continue;
        const studentId = Number(p.registration_students_id);
        const grade = (p.grade_level ?? "").trim();
        if (grade) gradeByStudent.set(studentId, grade);
        const crew = (p.crew_assignment ?? "").trim();
        if (crew) crewByStudent.set(studentId, crew);
      }
    }

    const wanted = new Set(studentIds);
    const requested = studentsResult.value.filter((s) => wanted.has(s.id));

    const cards: CredentialCardStudent[] = [];
    const skipped: string[] = [];
    for (const s of requested) {
      const email = (s.school_email ?? "").trim();
      const password = (s.school_password ?? "").trim();
      const name =
        `${(s.first_name ?? "").trim()} ${(s.last_name ?? "").trim()}`.trim() ||
        `Student #${s.id}`;
      if (!email || !password) {
        skipped.push(name);
        continue;
      }
      cards.push({
        firstName: (s.first_name ?? "").trim(),
        lastName: (s.last_name ?? "").trim(),
        gradeLevel: gradeByStudent.get(s.id) ?? "",
        crew: crewByStudent.get(s.id) ?? "",
        email,
        password,
      });
    }

    if (cards.length === 0) {
      return NextResponse.json(
        {
          error:
            'None of these students have a school account yet. Run "Create Student Emails" first.',
        },
        { status: 404 }
      );
    }

    // Crew, then last name — crews are the unit these get handed out
    // in, so the stack inside each folder reads like that crew's roll.
    // Blank crews sort last, into their own folder.
    cards.sort((a, b) => {
      const aCrew = a.crew.trim();
      const bCrew = b.crew.trim();
      if (!aCrew !== !bCrew) return aCrew ? -1 : 1;
      const crew = aCrew.localeCompare(bCrew);
      if (crew !== 0) return crew;
      const last = a.lastName.localeCompare(b.lastName);
      if (last !== 0) return last;
      return a.firstName.localeCompare(b.firstName);
    });

    // One folder per crew, in the sorted order above (Map preserves
    // insertion order, so the folders come out A, B, C… then blank).
    const byCrew = new Map<string, CredentialCardStudent[]>();
    for (const card of cards) {
      const folder = card.crew.trim() || NO_CREW_FOLDER;
      const bucket = byCrew.get(folder);
      if (bucket) bucket.push(card);
      else byCrew.set(folder, [card]);
    }

    const pdfOptions = { yearName: yearName || `Year #${yearId}` };
    const zip = new JSZip();

    for (const [crewName, crewCards] of byCrew) {
      const folder = safeName(crewName) || NO_CREW_FOLDER;
      // One document per crew — the crew's whole stack, in roll order,
      // so printing it is a single job. The filename repeats the crew
      // so it still identifies itself once moved out of its folder.
      const combined = await generateStudentCredentialPdf(
        crewCards,
        pdfOptions
      );
      zip.file(
        `${folder}/${folder} - ${crewCards.length} student${
          crewCards.length === 1 ? "" : "s"
        }.pdf`,
        combined
      );
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const slug =
      (yearName || `year-${yearId}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || `year-${yearId}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="student-logins-${slug}.zip"`,
        "Cache-Control": "no-store",
        // Surfaced by the roster button so admin learns which students
        // still need accounts generated instead of silently getting a
        // short stack.
        "X-Card-Count": String(cards.length),
        "X-Crew-Count": String(byCrew.size),
        "X-Skipped-Count": String(skipped.length),
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
