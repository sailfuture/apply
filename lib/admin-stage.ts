import { isMidYearAddition } from "@/lib/midyear-additions";
import { computeFamilyStageSets } from "@/lib/sms/stages";
import type {
  XanoApplication,
  XanoFamilyApplicationProgress,
  XanoSchoolYear,
  XanoStudent,
  XanoStudentRegistration,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/**
 * Stage-aware admin links — ONE answer to "which page is this family,
 * or this student, on right now?", shared by the dashboard search,
 * the list pages and the sheets that name a family or a student.
 * Before this every surface hard-coded a page (search sent enrolled
 * students to the application review, the lists each linked their
 * own stage page), so a name link landed on whatever page the
 * surface was built for instead of where the family actually is.
 *
 * The three admissions surfaces, by stage:
 *
 *   application  → /admin/families/[familyId]      (application review)
 *   registration → /admin/registrations/[familyId]  (accepted, packet
 *                                                   in progress)
 *   enrollment   → /admin/enrolled/[studentId]      (per student)
 *
 * Stage is DERIVED, never stored (the application row has no decision
 * flags — see lib/xano's `XanoApplication`), from the same rows the
 * pipeline board and the SMS stage buckets read:
 *
 *   - a family is accepted for a year when its apply-progress row's
 *     `isAccepted` is set (`computeFamilyStageSets` → registration);
 *   - a family is enrolled for a year when its registration-progress
 *     row's `isRegistrationConfirmed` latch is set on a non-archived
 *     row (→ enrolled), or when one of its students holds a confirmed
 *     packet for the year (residential placements never go through
 *     the family-level confirmation, so their packet is the only
 *     signal — the Enrolled roster counts them the same way);
 *   - a student is enrolled for a year when their packet is confirmed,
 *     or their family is enrolled for the year and they are not a
 *     pending mid-year addition (a sibling still in their own
 *     application / review / registration — `lib/midyear-additions`).
 *     A mid-year addition is enrolled once admin confirmed their
 *     packet (`student.isEnrolled`, set by that confirmation).
 *
 * Per student where the app distinguishes students (an enrolled
 * student next to a sibling still applying), per family otherwise.
 * A family-level link to an enrolled family opens the one enrolled
 * student's page when there is exactly one, else the family overview
 * (there is no family-level enrolled page; the overview lists every
 * student with a link to each).
 *
 * Which YEAR a family is "on" when it has rows in several: a year
 * that is not past beats a past one (a family enrolled two years ago
 * and applying again today is applying), then the most advanced
 * stage wins (a family enrolled this year and re-applying for next
 * year is enrolled), then the admin's working year, then the newer
 * year. Year-scoped callers (the list routes) pass one year's rows,
 * so for them the answer is simply that year's stage.
 *
 * Pure and dependency-free: routes feed it the rows they already
 * load; client components only ever call `stageHref` on a target a
 * route resolved.
 */
export type AdmissionStage = "application" | "registration" | "enrollment";

/** Where a family or student link should open. Routes resolve one of
 *  these per row; the page builds the URL with `stageHref`. */
export interface StageTarget {
  stage: AdmissionStage;
  familyId: number;
  /** The year the stage page is scoped to; null only when nothing is
   *  known about the family (the application page still renders). */
  yearId: number | null;
  /** Set when the link opens one student's enrolled page: the student
   *  the link is about, or an enrolled family's only student. */
  studentId: number | null;
  /** The student was unenrolled (archived); their enrolled page shows
   *  the departure. Lets a badge say "Unenrolled" over the stage. */
  unenrolled: boolean;
}

/** The URL for a resolved target. Student links carry `familyId` so
 *  the enrolled page can paint its family nav band before its own
 *  payload lands (same as the family nav's links). */
export function stageHref(target: StageTarget): string {
  const year = target.yearId ? `?yearId=${target.yearId}` : "";
  switch (target.stage) {
    case "enrollment":
      if (target.studentId) {
        return `/admin/enrolled/${target.studentId}${year}${
          year ? "&" : "?"
        }familyId=${target.familyId}`;
      }
      return `/admin/families/${target.familyId}/overview${year}`;
    case "registration":
      return `/admin/registrations/${target.familyId}${year}`;
    default:
      return `/admin/families/${target.familyId}${year}`;
  }
}

/** The target for a family nothing is known about: its application
 *  review page, on the given year when there is one. */
export function applicationTarget(
  familyId: number,
  yearId: number | string | null | undefined
): StageTarget {
  const y = Number(yearId);
  return {
    stage: "application",
    familyId,
    yearId: Number.isFinite(y) && y > 0 ? y : null,
    studentId: null,
    unenrolled: false,
  };
}

/** Narrow row shapes so routes can pass full Xano rows, year-scoped
 *  slices, or the family-overview payload without reshaping. */
export interface StageRows {
  applyProgress: ReadonlyArray<
    Pick<
      XanoFamilyApplicationProgress,
      | "registration_families_id"
      | "registration_school_years_id"
      | "isAccepted"
      | "isSubmitted"
      | "is_archived"
    >
  >;
  regProgress: ReadonlyArray<
    Pick<
      XanoStudentRegistrationProgress,
      | "registration_families_id"
      | "registration_school_years_id"
      | "isRegistrationConfirmed"
      | "isArchived"
    >
  >;
  applications: ReadonlyArray<
    Pick<
      XanoApplication,
      | "registration_families_id"
      | "registration_students_id"
      | "registration_school_years_id"
      | "isActive"
      | "is_midyear_addition"
      | "is_residential_addition"
    >
  >;
  students: ReadonlyArray<
    Pick<XanoStudent, "id" | "registration_families_id" | "isArchived" | "isEnrolled">
  >;
  /** Per-(student, year) packets; optional because not every caller
   *  loads them — without them a student is enrolled through the
   *  family latch only. */
  packets?: ReadonlyArray<
    Pick<
      XanoStudentRegistration,
      | "registration_students_id"
      | "registration_school_years_id"
      | "registrationConfirmed"
    >
  >;
  /** School years, for past-vs-current and newer-first ordering when
   *  a family has rows in several years. Optional for year-scoped
   *  callers. */
  years?: ReadonlyArray<
    Pick<XanoSchoolYear, "id" | "year_name" | "start_date" | "isPast">
  >;
}

export interface StageIndex {
  /** The family's current stage page. `fallbackYearId` scopes the
   *  application page when the family has no rows at all. */
  family(familyId: number, fallbackYearId?: number | null): StageTarget;
  /** The student's current stage page, or null when the student is
   *  not in the rows (callers fall back to the family). */
  student(studentId: number, fallbackYearId?: number | null): StageTarget | null;
}

/** Xano returns FKs as ids, numeric strings, or expanded `{ id }`
 *  objects depending on the endpoint; `Number(object)` is NaN. Kept
 *  local so this module never imports the server data layer. */
function idOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (v && typeof v === "object" && "id" in v) {
    return idOf((v as { id: unknown }).id);
  }
  return null;
}

const STAGE_RANK: Record<AdmissionStage, number> = {
  application: 0,
  registration: 1,
  enrollment: 2,
};

type Candidate = { yearId: number; stage: AdmissionStage };

export function buildStageIndex(
  rows: StageRows,
  opts: { preferredYearId?: number | string | null } = {}
): StageIndex {
  const preferred = idOf(opts.preferredYearId);

  // ── Year ordering: past years sort last, newer years first ──────
  const pastYears = new Set<number>();
  const yearKey = new Map<number, number>();
  for (const y of rows.years ?? []) {
    if (y.isPast) pastYears.add(y.id);
    const fromStart = y.start_date ? Date.parse(y.start_date) : NaN;
    const leading = parseInt(String(y.year_name ?? "").slice(0, 4), 10);
    yearKey.set(
      y.id,
      Number.isFinite(fromStart)
        ? fromStart
        : Number.isFinite(leading) && leading >= 1900
          ? Date.UTC(leading, 6, 1)
          : y.id
    );
  }
  const keyOf = (yearId: number) => yearKey.get(yearId) ?? yearId;

  // ── Family flags per year, via the shared SMS/SUFS bucketing ────
  const fapByYear = new Map<number, XanoFamilyApplicationProgress[]>();
  const srpByYear = new Map<number, XanoStudentRegistrationProgress[]>();
  const familyYears = new Map<number, Set<number>>();
  const addFamilyYear = (fid: number | null, yid: number | null) => {
    if (fid == null || yid == null) return;
    const set = familyYears.get(fid) ?? new Set<number>();
    set.add(yid);
    familyYears.set(fid, set);
  };
  for (const p of rows.applyProgress) {
    const fid = idOf(p.registration_families_id);
    const yid = idOf(p.registration_school_years_id);
    if (fid == null || yid == null) continue;
    const list = fapByYear.get(yid) ?? [];
    list.push({
      ...p,
      registration_families_id: fid,
      registration_school_years_id: yid,
    } as XanoFamilyApplicationProgress);
    fapByYear.set(yid, list);
    addFamilyYear(fid, yid);
  }
  for (const r of rows.regProgress) {
    const fid = idOf(r.registration_families_id);
    const yid = idOf(r.registration_school_years_id);
    if (fid == null || yid == null) continue;
    const list = srpByYear.get(yid) ?? [];
    list.push({
      ...r,
      registration_families_id: fid,
      registration_school_years_id: yid,
    } as XanoStudentRegistrationProgress);
    srpByYear.set(yid, list);
    addFamilyYear(fid, yid);
  }
  const setsByYear = new Map<number, ReturnType<typeof computeFamilyStageSets>>();
  for (const yid of new Set([...fapByYear.keys(), ...srpByYear.keys()])) {
    setsByYear.set(
      yid,
      computeFamilyStageSets({
        fap: fapByYear.get(yid) ?? [],
        srp: srpByYear.get(yid) ?? [],
      })
    );
  }

  // ── Students, applications, packets ──────────────────────────────
  const studentById = new Map<number, StageRows["students"][number]>();
  for (const s of rows.students) studentById.set(s.id, s);

  type App = StageRows["applications"][number];
  const appByStudentYear = new Map<number, Map<number, App>>();
  const studentsByFamilyYear = new Map<number, Map<number, Set<number>>>();
  const studentYears = new Map<number, Set<number>>();
  const addStudentYear = (sid: number, yid: number) => {
    const set = studentYears.get(sid) ?? new Set<number>();
    set.add(yid);
    studentYears.set(sid, set);
  };
  for (const a of rows.applications) {
    if (a.isActive === false) continue;
    const sid = idOf(a.registration_students_id);
    const yid = idOf(a.registration_school_years_id);
    const fid =
      idOf(a.registration_families_id) ??
      idOf(studentById.get(sid ?? 0)?.registration_families_id);
    if (sid == null || yid == null) continue;
    const byYear = appByStudentYear.get(sid) ?? new Map<number, App>();
    byYear.set(yid, a);
    appByStudentYear.set(sid, byYear);
    addStudentYear(sid, yid);
    if (fid != null) {
      addFamilyYear(fid, yid);
      const years = studentsByFamilyYear.get(fid) ?? new Map<number, Set<number>>();
      const set = years.get(yid) ?? new Set<number>();
      set.add(sid);
      years.set(yid, set);
      studentsByFamilyYear.set(fid, years);
    }
  }
  const confirmedPacket = new Map<number, Set<number>>();
  const packetYears = new Map<number, Set<number>>();
  for (const p of rows.packets ?? []) {
    const sid = idOf(p.registration_students_id);
    const yid = idOf(p.registration_school_years_id);
    if (sid == null || yid == null) continue;
    const years = packetYears.get(sid) ?? new Set<number>();
    years.add(yid);
    packetYears.set(sid, years);
    addStudentYear(sid, yid);
    const fid = idOf(studentById.get(sid)?.registration_families_id);
    if (fid != null) {
      addFamilyYear(fid, yid);
      const fyears = studentsByFamilyYear.get(fid) ?? new Map<number, Set<number>>();
      const set = fyears.get(yid) ?? new Set<number>();
      set.add(sid);
      fyears.set(yid, set);
      studentsByFamilyYear.set(fid, fyears);
    }
    if (p.registrationConfirmed === true) {
      const set = confirmedPacket.get(sid) ?? new Set<number>();
      set.add(yid);
      confirmedPacket.set(sid, set);
    }
  }

  const familyLatched = (fid: number, yid: number) =>
    setsByYear.get(yid)?.enrolled.has(fid) === true;
  const familyAccepted = (fid: number, yid: number) => {
    const sets = setsByYear.get(yid);
    return sets ? sets.enrolled.has(fid) || sets.registration.has(fid) : false;
  };
  const packetConfirmed = (sid: number, yid: number) =>
    confirmedPacket.get(sid)?.has(yid) === true;

  const familyConfirmed = (fid: number, yid: number): boolean => {
    if (familyLatched(fid, yid)) return true;
    for (const sid of studentsByFamilyYear.get(fid)?.get(yid) ?? []) {
      if (studentById.get(sid)?.isArchived === true) continue;
      if (packetConfirmed(sid, yid)) return true;
    }
    return false;
  };

  const familyStageIn = (fid: number, yid: number): AdmissionStage =>
    familyConfirmed(fid, yid)
      ? "enrollment"
      : familyAccepted(fid, yid)
        ? "registration"
        : "application";

  const studentEnrolledIn = (sid: number, yid: number): boolean => {
    const s = studentById.get(sid);
    if (!s || s.isArchived === true) return false;
    if (packetConfirmed(sid, yid)) return true;
    const app = appByStudentYear.get(sid)?.get(yid);
    if (!app) return false;
    const fid = idOf(app.registration_families_id) ?? idOf(s.registration_families_id);
    if (isMidYearAddition(app)) return s.isEnrolled === true;
    return fid != null && familyLatched(fid, yid);
  };

  const studentStageIn = (sid: number, fid: number, yid: number): AdmissionStage => {
    if (studentEnrolledIn(sid, yid)) return "enrollment";
    const app = appByStudentYear.get(sid)?.get(yid);
    if (app && isMidYearAddition(app)) {
      return packetYears.get(sid)?.has(yid) ? "registration" : "application";
    }
    return familyStageIn(fid, yid);
  };

  // Not-past first, then the most advanced stage, then the working
  // year, then the newer year.
  const pick = (candidates: Candidate[]): Candidate | null => {
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
      const pastDiff = Number(pastYears.has(a.yearId)) - Number(pastYears.has(b.yearId));
      if (pastDiff !== 0) return pastDiff;
      const stageDiff = STAGE_RANK[b.stage] - STAGE_RANK[a.stage];
      if (stageDiff !== 0) return stageDiff;
      const prefDiff = Number(b.yearId === preferred) - Number(a.yearId === preferred);
      if (prefDiff !== 0) return prefDiff;
      return keyOf(b.yearId) - keyOf(a.yearId);
    })[0];
  };

  const family = (familyId: number, fallbackYearId?: number | null): StageTarget => {
    const years = familyYears.get(familyId);
    if (!years || years.size === 0) {
      return applicationTarget(familyId, fallbackYearId);
    }
    const best = pick(
      [...years].map((yearId) => ({
        yearId,
        stage: familyStageIn(familyId, yearId),
      }))
    )!;
    let studentId: number | null = null;
    if (best.stage === "enrollment") {
      const enrolled = [
        ...(studentsByFamilyYear.get(familyId)?.get(best.yearId) ?? []),
      ].filter((sid) => studentEnrolledIn(sid, best.yearId));
      if (enrolled.length === 1) studentId = enrolled[0];
    }
    return {
      stage: best.stage,
      familyId,
      yearId: best.yearId,
      studentId,
      unenrolled: false,
    };
  };

  const student = (
    studentId: number,
    fallbackYearId?: number | null
  ): StageTarget | null => {
    const s = studentById.get(studentId);
    if (!s) return null;
    const familyId = idOf(s.registration_families_id) ?? 0;
    const years = studentYears.get(studentId);
    if (!years || years.size === 0) {
      return familyId ? family(familyId, fallbackYearId) : null;
    }
    if (s.isArchived === true) {
      // Their own page shows the departure, under the year they were
      // last on (newest first; the working year when it is one).
      const best = pick(
        [...years].map((yearId) => ({ yearId, stage: "enrollment" as const }))
      )!;
      return {
        stage: "enrollment",
        familyId,
        yearId: best.yearId,
        studentId,
        unenrolled: true,
      };
    }
    const candidates: Candidate[] = [...years].map((yearId) => ({
      yearId,
      stage: studentStageIn(studentId, familyId, yearId),
    }));
    // `isEnrolled` is the roster's own enrolled flag (set by the
    // family confirmation cascade and by a packet confirmation). When
    // no year's rows say enrolled but the flag does, trust the flag on
    // the newest year the student is on — the Enrolled roster lists
    // them under that year as enrolled, so the link should match.
    if (
      s.isEnrolled === true &&
      !candidates.some((c) => c.stage === "enrollment")
    ) {
      const newest = pick(candidates.map((c) => ({ ...c, stage: "application" as const })))!;
      for (const c of candidates) {
        if (c.yearId === newest.yearId) c.stage = "enrollment";
      }
    }
    const best = pick(candidates)!;
    return {
      stage: best.stage,
      familyId,
      yearId: best.yearId,
      studentId: best.stage === "enrollment" ? studentId : null,
      unenrolled: false,
    };
  };

  return { family, student };
}
