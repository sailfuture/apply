import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { formatUSPhone, toE164 } from "@/lib/phone";
import { normPhone, pickAccountHolderParent } from "@/lib/sms/contacts";
import { computeFamilyStageSets } from "@/lib/sms/stages";

/**
 * Group-message audience directory — every textable contact for the
 * compose dialog's searchable multi-select, annotated with the
 * furthest pipeline stage each has reached.
 *
 *   GET /api/admin/messages/group/audience?yearId=Y  →  { contacts }
 *
 * One row per REAL person/household. The same family often exists in
 * multiple record types (an inquiry that applied; a camp parent who
 * enrolled), so rows dedupe by normalized phone with the
 * furthest-along record winning:
 *
 *   enrolled > registration > application > inquiry > camp
 *
 * Family rows carry their stage for the requested year:
 *   - enrolled     — registration confirmed (`isRegistrationConfirmed`)
 *   - registration — accepted for the year (working the packet)
 *   - application  — submitted, not yet decided (families whose every
 *                    active application was denied are excluded — a
 *                    blast must not text turned-down families)
 * Families with no activity for the year are omitted; the single-
 * message picker still reaches them. Inquiry / camp / visit / TASCO
 * rows aren't year-scoped and always list (minus phone-collisions
 * with rows further up the ladder).
 *
 * Each contact also carries its students with parsed grade levels
 * (8–12) so the dialog can filter/group the audience by incoming
 * grade, plus reachability (phone on file, opt-out) and, for
 * families, whether they hold an outstanding balance for the year.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [
      fap,
      srp,
      apps,
      students,
      families,
      inquiries,
      campRows,
      txns,
      packets,
    ] = await Promise.all([
      xano.familyApplicationProgress.getByYear(yearId).catch(() => []),
      xano.studentRegistrationProgress.getByYear(yearId).catch(() => []),
      xano.applications.getAll().catch(() => []),
      xano.students.getAll().catch(() => []),
      xano.families.getAllDetails().catch(() => []),
      xano.inquiries.getAll().catch(() => []),
      xano.summerCamp.getAll().catch(() => []),
      xano.paymentTransactions.getAllByYear(yearId).catch(() => []),
      xano.studentRegistration.getByYear(yearId).catch(() => []),
    ]);
    const [waivers, tascoRows] = await Promise.all([
      xano.websiteWaivers.getAll().catch(() => []),
      xano.tascoSummerVisits.getAll().catch(() => []),
    ]);

    // ── Family stage sets — shared bucketing (also powers the inbox
    //    stage filter) so the two surfaces can't disagree. ──
    const stageSets = computeFamilyStageSets({ fap, srp });
    const familyStage = (fid: number): GroupStage | null => {
      if (stageSets.enrolled.has(fid)) return "enrolled";
      if (stageSets.registration.has(fid)) return "registration";
      if (stageSets.application.has(fid)) return "application";
      return null; // no year activity (or all-denied) — not listed
    };

    // ── Per-family students + grades for the year ────────────────────
    const studentNameById = new Map(
      students.map((s) => [
        s.id,
        `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
      ])
    );
    // Admin-set packet placement (grade_level) wins over the
    // application's incoming grade — it's the grade the Enrolled
    // roster shows, so the composer's grade chips match that page.
    // Crew assignment rides along from the same packet rows so the
    // composer can narrow a blast to one crew ("just Crew E").
    const packetGradeByStudent = new Map<number, string>();
    const packetCrewByStudent = new Map<number, string>();
    for (const p of packets) {
      const sid = Number(p.registration_students_id);
      if (!sid) continue;
      const g = (p.grade_level ?? "").trim();
      if (g) packetGradeByStudent.set(sid, g);
      const crew = (p.crew_assignment ?? "").trim();
      if (crew) packetCrewByStudent.set(sid, crew);
    }
    const familyStudents = new Map<
      number,
      Array<{
        name: string;
        grade: number | null;
        gradeRaw: string;
        crew: string;
        busStop: string;
      }>
    >();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const fid = Number(a.registration_families_id);
      const sid = Number(a.registration_students_id);
      if (!fid || !sid) continue;
      const list = familyStudents.get(fid) ?? [];
      // Dedupe per student (re-created application rows).
      if (!list.some((s) => s.name === (studentNameById.get(sid) ?? ""))) {
        const gradeRaw =
          packetGradeByStudent.get(sid) ??
          (a.current_grade ?? "").trim();
        list.push({
          name: studentNameById.get(sid) ?? "",
          grade: parseGrade(gradeRaw),
          gradeRaw,
          crew: packetCrewByStudent.get(sid) ?? "",
          // Bus election lives on the application row; the stop is
          // stored by NAME. Only bus riders carry one.
          busStop:
            a.is_bus_transportation === true
              ? (a.bus_stop ?? "").trim()
              : "",
        });
      }
      familyStudents.set(fid, list);
    }

    // ── Outstanding balances (families only) ─────────────────────────
    const outstandingFamilies = new Set<number>();
    for (const t of txns) {
      if (t.status !== "open" && t.status !== "uncollectible") continue;
      const bal = (t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0);
      if (bal > 0) outstandingFamilies.add(t.registration_families_id);
    }

    // ── Build rows, families first (they own phone-collision wins) ───
    const contacts: GroupContact[] = [];
    const familyPhones = new Set<string>();

    for (const fam of families) {
      const stage = familyStage(fam.id);
      if (!stage) continue;
      const parent = pickAccountHolderParent(fam.registration_parents_id);
      const e164 = toE164(parent?.phone ?? null);
      const optedOut = Boolean(parent?.sms_opted_out_at);
      // Every parent's number claims the household — an inquiry/camp
      // row matching EITHER parent is the same family, further along.
      for (const p of fam.registration_parents_id) {
        const key = normPhone(p.phone);
        if (key.length === 10) familyPhones.add(key);
      }
      const kids = familyStudents.get(fam.id) ?? [];
      contacts.push({
        key: `family-${fam.id}`,
        type: "family",
        id: fam.id,
        name: fam.family_name?.trim() || `Family #${fam.id}`,
        personName: parent
          ? `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim()
          : "",
        stage,
        students: kids
          .map((k) => {
            if (!k.name) return "";
            // "(8th · Crew E)" — crew shows beside the grade so the
            // recipient row answers "whose kid is in which crew" at a
            // glance, and plain search ("crew e") matches it too.
            const detail = [
              k.gradeRaw ? gradeLabel(k.grade, k.gradeRaw) : "",
              k.crew,
            ]
              .filter(Boolean)
              .join(" · ");
            return detail ? `${k.name} (${detail})` : k.name;
          })
          .filter(Boolean)
          .join(", "),
        grades: [
          ...new Set(
            kids
              .map((k) => k.grade)
              .filter((g): g is number => g !== null)
          ),
        ],
        crews: [...new Set(kids.map((k) => k.crew).filter(Boolean))],
        busStops: [
          ...new Set(kids.map((k) => k.busStop).filter(Boolean)),
        ],
        phone: formatUSPhone(parent?.phone ?? "") || "",
        hasPhone: Boolean(e164),
        optedOut,
        sendable: Boolean(e164) && !optedOut,
        outstanding: outstandingFamilies.has(fam.id),
      });
    }

    // Inquiries — skipped when their phone belongs to a family
    // (that household is further along) or they said not-interested.
    const inquiryPhones = new Set<string>();
    for (const i of inquiries) {
      if (i.status === "not_interested") continue;
      const key = normPhone(i.primary_phone);
      if (key.length === 10 && familyPhones.has(key)) continue;
      const e164 = toE164(String(i.primary_phone ?? ""));
      const optedOut = i.messaging_opt_in === false;
      const student =
        `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim();
      const grade = parseGrade(i.starting_grade || i.current_grade);
      if (key.length === 10) inquiryPhones.add(key);
      contacts.push({
        key: `inquiry-${i.id}`,
        type: "inquiry",
        id: i.id,
        name:
          `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim() ||
          `Inquiry #${i.id}`,
        personName:
          `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim(),
        stage: "inquiry",
        students: student
          ? grade !== null
            ? `${student} (${grade}th)`
            : student
          : "",
        grades: grade !== null ? [grade] : [],
        phone: formatUSPhone(String(i.primary_phone ?? "")) || "",
        hasPhone: Boolean(e164),
        optedOut,
        sendable: Boolean(e164) && !optedOut,
        outstanding: false,
        // Admin's interest stars — shown on lead rows in the group
        // composer so warm leads stand out, and filterable there.
        rating: Number(i.interest_level) || 0,
      });
    }

    // Camp — lowest rung; skipped when the phone matches a family OR
    // an inquiry (both are further along per the stage ladder). Camp
    // rows record last grade COMPLETED, so the filterable grade is
    // +1 (their incoming grade).
    const campPhones = new Set<string>();
    for (const c of campRows) {
      const key = normPhone(c.primary_phone);
      if (key.length === 10 && (familyPhones.has(key) || inquiryPhones.has(key)))
        continue;
      if (key.length === 10) campPhones.add(key);
      const e164 = toE164(c.primary_phone ?? "");
      const student =
        `${c.student_first_name ?? ""} ${c.student_last_name ?? ""}`.trim();
      const completed = parseGrade(c.last_grade_completed);
      const incoming =
        completed !== null && completed + 1 >= 8 && completed + 1 <= 12
          ? completed + 1
          : null;
      contacts.push({
        key: `camp-${c.id}`,
        type: "camp",
        id: c.id,
        name:
          `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim() ||
          `Camp #${c.id}`,
        personName:
          `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim(),
        stage: "camp",
        students: student
          ? incoming !== null
            ? `${student} (rising ${incoming}th)`
            : student
          : "",
        grades: incoming !== null ? [incoming] : [],
        phone: formatUSPhone(c.primary_phone ?? "") || "",
        hasPhone: Boolean(e164),
        // No opt-out column on camp rows; carrier-level STOP still
        // blocks the send.
        optedOut: false,
        sendable: Boolean(e164),
        outstanding: false,
        rating: Number(c.interest_level) || 0,
      });
    }

    // Liability-waiver visit signers — only OPTED-IN signers list (the
    // marketing checkbox on the public form is the texting consent),
    // and any phone already claimed by a family, inquiry, or camp row
    // wins over the visit record.
    const visitPhones = new Set<string>();
    for (const w of waivers) {
      if (w.marketing_opt_in !== true) continue;
      const key = normPhone(w.parent_phone);
      if (
        key.length === 10 &&
        (familyPhones.has(key) ||
          inquiryPhones.has(key) ||
          campPhones.has(key))
      ) {
        continue;
      }
      if (key.length === 10) visitPhones.add(key);
      const e164 = toE164(w.parent_phone ?? "");
      const personName = (w.parent_name ?? "").trim();
      const student = (w.student_name ?? "").trim();
      const grade = parseGrade(w.student_grade);
      contacts.push({
        key: `visit-${w.id}`,
        type: "visit",
        id: w.id,
        name: personName || `Visit #${w.id}`,
        personName,
        stage: "visit",
        students: student
          ? grade !== null
            ? `${student} (${grade}th)`
            : student
          : "",
        grades: grade !== null ? [grade] : [],
        phone: formatUSPhone(w.parent_phone ?? "") || "",
        hasPhone: Boolean(e164),
        optedOut: false,
        sendable: Boolean(e164),
        outstanding: false,
        rating: Number(w.interest_level) || 0,
      });
    }

    // TASCO summer-visit sign-ups — bottom rung. Signing up at the
    // rec-center table is the consent signal (same implied-consent
    // stance as camp; carrier-level STOP still applies), so ALL rows
    // with a phone list, not just marketing opt-ins. No parent name on
    // the form — rows read "Parent of <student>".
    for (const t of tascoRows) {
      const key = normPhone(t.parent_phone);
      if (
        key.length === 10 &&
        (familyPhones.has(key) ||
          inquiryPhones.has(key) ||
          campPhones.has(key) ||
          visitPhones.has(key))
      ) {
        continue;
      }
      const e164 = toE164(t.parent_phone ?? "");
      const student = (t.student_name ?? "").trim();
      const grade = parseGrade(t.current_grade);
      contacts.push({
        key: `tasco-${t.id}`,
        type: "tasco",
        id: t.id,
        name: student ? `Parent of ${student}` : `TASCO #${t.id}`,
        personName: "",
        stage: "tasco",
        students: student
          ? grade !== null
            ? `${student} (${grade}th)`
            : student
          : "",
        grades: grade !== null ? [grade] : [],
        phone: formatUSPhone(t.parent_phone ?? "") || "",
        hasPhone: Boolean(e164),
        optedOut: false,
        sendable: Boolean(e164),
        outstanding: false,
        rating: Number(t.interest_level) || 0,
      });
    }

    // Stage ladder first (furthest along at the top), then name — the
    // dialog's grade chips + search narrow from there.
    const rank: Record<GroupStage, number> = {
      enrolled: 0,
      registration: 1,
      application: 2,
      inquiry: 3,
      camp: 4,
      visit: 5,
      tasco: 6,
    };
    contacts.sort(
      (a, b) => rank[a.stage] - rank[b.stage] || a.name.localeCompare(b.name)
    );

    return NextResponse.json({ contacts } satisfies GroupAudienceResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** First number 8–12 found in a free-text grade ("8th", "9", "10th
 *  grade"); null otherwise. Same rule the SUFS page uses. */
function parseGrade(raw: string | null | undefined): number | null {
  const m = /(\d{1,2})/.exec(raw ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 8 && n <= 12 ? n : null;
}

/** "8th" when parsed, else the raw text the parent typed. */
function gradeLabel(grade: number | null, raw: string): string {
  return grade !== null ? `${grade}th` : raw;
}

export type GroupStage =
  | "enrolled"
  | "registration"
  | "application"
  | "inquiry"
  | "camp"
  | "visit"
  | "tasco";

export interface GroupContact {
  /** Stable selection key: `${type}-${id}`. */
  key: string;
  type: "family" | "inquiry" | "camp" | "visit" | "tasco";
  id: number;
  /** Display name — family name, or the parent's name for
   *  inquiry/camp rows. */
  name: string;
  /** Who actually receives the text. */
  personName: string;
  /** Furthest pipeline stage this contact has reached. */
  stage: GroupStage;
  /** "Steven Petros (8th), Maya Petros (10th)" — display line. */
  students: string;
  /** Distinct parsed grades 8–12 — drives the dialog's grade filter. */
  grades: number[];
  /** Families only — distinct crew assignments ("Crew A"–"Crew E")
   *  across the family's packet rows for the year. Drives the
   *  composer's crew filter; absent/empty on lead rows. */
  crews?: string[];
  /** Families only — distinct bus-stop names across the family's
   *  bus-riding students for the year (application rows with
   *  `is_bus_transportation`). Drives the enrolled composer's
   *  bus-stop filter; absent/empty on lead rows and non-bus
   *  families. */
  busStops?: string[];
  /** Display-formatted phone ("(727) 555-0143"); empty when none on
   *  file. Shown on every recipient row. */
  phone: string;
  hasPhone: boolean;
  optedOut: boolean;
  /** Has a number on file and hasn't opted out. */
  sendable: boolean;
  /** Families only — open/uncollectible balance for the year. */
  outstanding: boolean;
  /** Lead rows (inquiry / camp / visit / TASCO) — admin's 1–5
   *  conversion-likelihood stars (0 = unrated). */
  rating?: number;
}

export interface GroupAudienceResponse {
  contacts: GroupContact[];
}
