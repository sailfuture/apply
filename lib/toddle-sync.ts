import { stripNameSuffix } from "@/lib/name-suffix";
import { xano } from "@/lib/xano";
import type {
  XanoFamily,
  XanoParent,
  XanoSchoolYear,
  XanoStudent,
} from "@/lib/xano";
import {
  diffStudentFields,
  findDuplicateCandidates,
  matchToddleStudent,
  toStudentBody,
  upsertStudent,
  uploadStudentProfileImage,
  syncFamilyMembers,
  syncCrewClass,
  getParents,
  getCourses,
  getCourseStudentIds,
  getAllStudents,
  getStudentsBySourceIds,
  archiveStudent,
  unarchiveStudent,
  isToddleConfigured,
  ToddleSyncError,
} from "@/lib/toddle";
import {
  toddleDob,
  toddleEmail,
  toddleEnrollmentDate,
  toddleGender,
  toddlePhone,
} from "@/lib/toddle-readiness";
import type {
  ToddleCourse,
  ToddleDuplicateCandidate,
  ToddleFamilyMemberInput,
  ToddleFamilyMemberResult,
  ToddleParentRecord,
  ToddleStudent,
  ToddleSyncFields,
  ToddleUpsertResult,
} from "@/lib/toddle";

/**
 * The full "Sync to Toddle" for ONE student, shared by the
 * per-student route (`/api/admin/students/[id]/toddle-sync`) and the
 * bulk route (`/api/admin/students/toddle-sync-all`): upsert the
 * Toddle student (identity + school email + enrollment date + home
 * address + year group), push the photo, upsert every family contact
 * as a parent account + contact card, and place the student in their
 * crew's Toddle class.
 *
 * The student upsert THROWS on sync-blocking conditions (Toddle
 * errors, `ToddleSyncError` for admin-fixable ones) — callers decide
 * whether that's a 422 (single) or a per-student "failed" row (bulk).
 * Photo / family / crew are best-effort and report rather than throw.
 */

/**
 * Caches shared across students in one run. The single-student route
 * builds one per request (only `years` is prefetched — everything
 * else lazy-fills); the bulk route additionally preloads the Toddle
 * side so 60 students don't re-fetch the same org-wide lists.
 */
export interface ToddleSyncShared {
  years: XanoSchoolYear[];
  activeYear: XanoSchoolYear | null;
  /** Lazy per-family caches — siblings share family + parent rows. */
  familyById: Map<number, XanoFamily | null>;
  parentById: Map<number, XanoParent | null>;
  /** Bulk preloads (optional): org-wide Toddle lists fetched once. */
  toddleParents?: ToddleParentRecord[];
  courses?: ToddleCourse[];
  courseRosters?: Map<string, string[]>;
  /** Toddle roster keyed by sourceId ("sfa-<id>") — lets the bulk run
   *  hand `upsertStudent` a known id instead of per-student lookups. */
  toddleIdBySource?: Map<string, string>;
  /** The same roster, whole records rather than ids, so the upsert can
   *  report WHICH fields changed. Comes from the one roster fetch the
   *  bulk run already makes, so the diff costs no extra API calls —
   *  which matters: Toddle rate-limits, and a per-student read on a
   *  75-student run would trip it. */
  toddleStudentBySource?: Map<string, ToddleStudent>;
}

export async function buildToddleSyncShared(opts?: {
  /** Also prefetch the Toddle-side org lists (bulk runs). */
  preloadToddle?: boolean;
}): Promise<ToddleSyncShared> {
  const years = await xano.schoolYears.getAll().catch(() => []);
  const shared: ToddleSyncShared = {
    years,
    activeYear: years.find((y) => y.isActive) ?? null,
    familyById: new Map(),
    parentById: new Map(),
  };
  if (opts?.preloadToddle) {
    const [toddleParents, courses, roster] = await Promise.all([
      getParents(),
      getCourses(),
      getAllStudents(),
    ]);
    shared.toddleParents = toddleParents;
    shared.courses = courses;
    const ours = roster.filter(
      (s) => (s.sourceId ?? "").startsWith("sfa-") && !s.isArchived
    );
    shared.toddleIdBySource = new Map(
      ours.map((s) => [s.sourceId as string, String(s.id)])
    );
    shared.toddleStudentBySource = new Map(
      ours.map((s) => [s.sourceId as string, s])
    );
    // Crew-class rosters, fetched once and kept current by
    // `syncCrewClass` as students move.
    const crewCourses = courses.filter(
      (c) => !c.isArchived && /^crew\b/i.test((c.title ?? c.name ?? "").trim())
    );
    shared.courseRosters = new Map();
    await Promise.all(
      crewCourses.map(async (c) => {
        shared.courseRosters!.set(
          c.id,
          await getCourseStudentIds(c.id).catch(() => [])
        );
      })
    );
  }
  return shared;
}

/**
 * Assemble exactly the fields a sync would push for one student.
 *
 * Pure — the caller supplies the rows it already has. Split out of
 * `syncStudentToToddle` so the pre-sync preview can diff the SAME
 * payload the sync sends: a preview built from a parallel copy of this
 * logic would drift, and a preview that lies about what will change is
 * worse than no preview.
 */
export function buildToddleSyncFields({
  student,
  packet,
  primaryParent,
  enrollmentYear,
  gradeLevelHint,
}: {
  student: XanoStudent;
  packet?: { grade_level?: string; crew_assignment?: string } | null;
  primaryParent?: XanoParent | null;
  enrollmentYear?: XanoSchoolYear | null;
  gradeLevelHint?: string;
}): ToddleSyncFields {
  const addr = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : undefined;
  };
  return {
    sourceId: `sfa-${student.id}`,
    // Suffixes are dropped on the way out: Toddle is a roster, not a
    // formal record, and "Mebane Jr." there beside "Mebane" is how one
    // student becomes two. Xano keeps what the family actually wrote.
    firstName: stripNameSuffix(student.first_name),
    lastName: stripNameSuffix(student.last_name),
    dob: toddleDob(student.date_of_birth),
    gender: toddleGender(student.gender),
    phoneNumber: toddlePhone(student.student_phone),
    gradeLevel:
      (gradeLevelHint ?? "").trim() ||
      (packet?.grade_level ?? "").trim() ||
      undefined,
    email: toddleEmail(student.school_email),
    enrollmentDate: toddleEnrollmentDate(enrollmentYear),
    addressLine1: addr(primaryParent?.address_line_1),
    addressLine2: addr(primaryParent?.address_line_2),
    city: addr(primaryParent?.city),
    state: addr(primaryParent?.state),
    zipcode: addr(primaryParent?.zipcode),
  };
}

/* ────────────────────────── Pre-sync preview ────────────────────── */

export interface ToddleSyncPreview {
  /** `create` — no Toddle record matches, one will be made.
   *  `change` — matched, and these fields differ.
   *  `current` — matched, nothing differs.
   *  `review` — would create, but the roster holds a near-match, so
   *    the sync stops and asks rather than risking a duplicate.
   *  `conflict` — would create, but Toddle already holds a record with
   *    this student's school email, so the create will be REJECTED.
   *  `unknown` — Toddle couldn't be read, so no comparison was made. */
  status:
    | "create"
    | "change"
    | "current"
    | "review"
    | "conflict"
    | "unknown";
  changedFields: string[];
  /** How the existing record was found, mirroring the sync's own
   *  matching order. Null when nothing matched. */
  matchedBy: "stored" | "sourceId" | "email" | "name" | null;
  /** Set on `conflict` — what Toddle already has, so admin can go fix
   *  the record rather than re-running a sync that can't succeed. */
  note?: string;
  /** Set on `review` — the records this student might already be. */
  candidates?: ToddleDuplicateCandidate[];
}

/**
 * What a sync WOULD do to one student, without touching Toddle.
 *
 * Matching mirrors `upsertStudent` exactly — stored id, then our
 * sourceId, then name (+DOB when both sides carry one) — so the
 * preview can't promise an update the sync will turn into a create.
 * That fidelity is the point: the failures this surfaces are precisely
 * the ones where Toddle holds the student under a different spelling
 * ("Daiquan" vs "Dai'quan", a "Jr." suffix) or a different DOB, so the
 * matcher misses, the create fires, and Toddle rejects it because the
 * school email is already taken.
 *
 * `roster` is Toddle's student list. Note that it excludes ARCHIVED
 * records, which is why a student whose Toddle profile was archived
 * can preview as `create` and still fail on a sourceId collision.
 */
export function previewToddleStudent({
  student,
  fields,
  roster,
  yearGroupId,
}: {
  student: XanoStudent;
  fields: ToddleSyncFields;
  roster: ToddleStudent[] | null;
  /** Resolved year group for the student's grade, when the caller
   *  could resolve one. Compared by id, never by label. */
  yearGroupId?: string;
}): ToddleSyncPreview {
  if (!roster) {
    return { status: "unknown", changedFields: [], matchedBy: null };
  }

  const storedId = (student.toddle_student_id ?? "").trim();
  let match: ToddleStudent | undefined;
  let matchedBy: ToddleSyncPreview["matchedBy"] = null;

  if (storedId) {
    match = roster.find((r) => String(r.id) === storedId);
    if (match) matchedBy = "stored";
  }
  if (!match) {
    const bySource = roster.filter((r) => r.sourceId === fields.sourceId);
    match = bySource.find((r) => !r.isArchived) ?? bySource[0];
    if (match) matchedBy = "sourceId";
  }
  if (!match) {
    // Same helper the sync uses — email first, then punctuation-blind
    // name + DOB — so the preview can't promise a different outcome.
    const rosterMatch = matchToddleStudent(roster, fields);
    if (rosterMatch) {
      match = rosterMatch.student;
      matchedBy = rosterMatch.matchedBy;
    }
  }

  if (!match) {
    // No match means a create — which Toddle refuses if the email is
    // already spoken for. Worth knowing BEFORE the run, since that is
    // the exact failure mode a stale name or DOB produces.
    const email = (fields.email ?? "").toLowerCase();
    const emailOwner = email
      ? roster.find((r) => (r.email ?? "").toLowerCase() === email)
      : undefined;
    if (emailOwner) {
      return {
        status: "conflict",
        changedFields: [],
        matchedBy: null,
        note: `Toddle already has "${(emailOwner.firstName ?? "").trim()} ${(
          emailOwner.lastName ?? ""
        ).trim()}" on ${fields.email} — the create will be rejected. Fix the name or date of birth on either side so they match, or set sourceId "${fields.sourceId}" on that Toddle record.`,
      };
    }
    // Same near-match check the sync runs before it creates, so the
    // dialog can collect the decision up front instead of failing 76
    // students into an error list.
    const candidates = findDuplicateCandidates(roster, fields);
    if (candidates.length > 0) {
      return { status: "review", changedFields: [], matchedBy: null, candidates };
    }
    return { status: "create", changedFields: [], matchedBy: null };
  }

  const body = toStudentBody(fields);
  const withYearGroup = yearGroupId ? { ...body, yearGroupId } : body;
  const diff = diffStudentFields(match, withYearGroup);
  return {
    status: diff.compared && diff.changedFields.length === 0 ? "current" : "change",
    changedFields: diff.changedFields,
    matchedBy,
  };
}

export interface ToddleStudentSyncOutcome extends ToddleUpsertResult {
  persisted: boolean;
  photo: "synced" | "none" | "failed";
  familyMembers: ToddleFamilyMemberResult[];
  crew: string | null;
}

export async function syncStudentToToddle(
  student: XanoStudent,
  /** Grade label ("9th") from the caller when it has a fresher source
   *  (the client sends the packet grade); the packet is the fallback. */
  gradeLevelHint: string | undefined,
  shared: ToddleSyncShared,
  opts?: {
    /** The admin looked at the near-matches for this student and said
     *  it really is a new child — create rather than stopping. */
    allowCreate?: boolean;
  }
): Promise<ToddleStudentSyncOutcome> {
  const id = student.id;
  const firstName = (student.first_name ?? "").trim();
  const lastName = (student.last_name ?? "").trim();
  if (!firstName || !lastName) {
    throw new ToddleSyncError(
      "Student needs both a first and last name to sync."
    );
  }

  // Family + parents (primary = lowest id, matching every other admin
  // surface) — cached across siblings in a bulk run.
  const familyId = Number(student.registration_families_id) || 0;
  let family = shared.familyById.get(familyId) ?? null;
  if (familyId && !shared.familyById.has(familyId)) {
    family = await xano.families.getById(familyId).catch(() => null);
    shared.familyById.set(familyId, family);
  }
  const parentIds = family ? xano.families.getParentIds(family) : [];
  const familyParents: XanoParent[] = [];
  for (const pid of parentIds) {
    if (!shared.parentById.has(pid)) {
      shared.parentById.set(
        pid,
        await xano.parents.getById(pid).catch(() => null)
      );
    }
    const p = shared.parentById.get(pid);
    if (p) familyParents.push(p);
  }
  familyParents.sort((a, b) => a.id - b.id);
  const primaryParent = familyParents[0] ?? null;

  // Per-year packet — crew + server-side grade fallback.
  const packet = shared.activeYear
    ? ((await xano.studentRegistration
        .getByStudentAndYear(id, shared.activeYear.id)
        .catch(() => null)) ??
      (await xano.studentRegistration.getByStudentId(id).catch(() => null)))
    : await xano.studentRegistration.getByStudentId(id).catch(() => null);

  // Enrollment date = start of the school year the student first
  // enrolled in (the School Account card's year pick).
  const enrollmentYear =
    shared.years.find(
      (y) => y.id === Number(student.enrollment_school_years_id)
    ) ?? null;

  const sourceId = `sfa-${id}`;
  const knownToddleId =
    student.toddle_student_id || shared.toddleIdBySource?.get(sourceId);

  // What Toddle holds right now, for the changed-fields report. The
  // bulk run has it preloaded; a single-student sync spends one lookup
  // to get it, and simply reports "updated" if that lookup fails.
  let existing = shared.toddleStudentBySource?.get(sourceId) ?? null;
  if (!existing && knownToddleId) {
    existing =
      (await getStudentsBySourceIds([sourceId])
        .then((rows) => rows.find((r) => !r.isArchived) ?? rows[0] ?? null)
        .catch(() => null)) ?? null;
  }

  const result = await upsertStudent(
    buildToddleSyncFields({
      student,
      packet,
      primaryParent,
      enrollmentYear,
      gradeLevelHint,
    }),
    knownToddleId || undefined,
    existing,
    { allowCreate: opts?.allowCreate }
  );

  // Push the student's headshot (the admin-uploaded `student_photo`
  // on the Xano row) onto the Toddle profile. Best-effort: a photo
  // failure never fails the sync — the record itself already landed.
  let photo: "synced" | "none" | "failed" = "none";
  const photoUrl = resolvePhotoUrl(student.student_photo);
  if (photoUrl) {
    try {
      const base64Image = await fetchImageAsBase64(photoUrl);
      await uploadStudentProfileImage(result.toddleId, base64Image);
      photo = "synced";
    } catch (err) {
      photo = "failed";
      console.error(
        `[toddle-sync] photo upload failed for student ${id}:`,
        err
      );
    }
  }

  // Family members → Toddle parent accounts + contact-details cards
  // on the student, primary and secondary contacts alike. Per-member
  // outcomes come back for reporting; failures never fail the sync.
  const memberInputs: ToddleFamilyMemberInput[] = familyParents
    .filter((p) => (p.first_name ?? "").trim() && (p.last_name ?? "").trim())
    .map((p) => {
      const digits = (p.phone ?? "").replace(/\D/g, "");
      const memberPhone =
        digits.length === 10
          ? `+1${digits}`
          : digits.length === 11 && digits.startsWith("1")
            ? `+${digits}`
            : digits || undefined;
      return {
        firstName: p.first_name.trim(),
        lastName: p.last_name.trim(),
        email: toddleEmail(p.email),
        phoneNumber: memberPhone,
        relationship: (p.relationship ?? "").trim() || undefined,
      };
    });
  let familyMembers: ToddleFamilyMemberResult[] = [];
  try {
    familyMembers = await syncFamilyMembers(result.toddleId, memberInputs, {
      parents: shared.toddleParents,
    });
  } catch (err) {
    console.error(
      `[toddle-sync] family member sync failed for student ${id}:`,
      err
    );
  }

  // Crew → membership in the matching "Crew …" Toddle class (adds to
  // the right one, pulls out of a stale one on crew moves).
  const crewName = (packet?.crew_assignment ?? "").trim();
  const crew = crewName
    ? await syncCrewClass(result.toddleId, crewName, {
        courses: shared.courses,
        rosters: shared.courseRosters,
      })
    : null;

  // Persist the Toddle id back onto the student row so the next sync
  // is a direct update. Best-effort: if the columns haven't been
  // added in Xano yet the write is a no-op / failure, and the
  // sourceId lookup still keeps syncs idempotent.
  let persisted = false;
  try {
    await xano.students.updateOnAdminGroup(id, {
      toddle_student_id: result.toddleId,
      toddle_synced_at: Date.now(),
    });
    persisted = true;
  } catch (err) {
    console.error(
      `[toddle-sync] couldn't persist toddle_student_id for student ${id}:`,
      err
    );
  }

  return { ...result, persisted, photo, familyMembers, crew };
}

/**
 * Mirror an apply-portal enrollment change onto Toddle: unenrolling a
 * student here archives them there, re-enrolling unarchives. Resolves
 * the Toddle student via the stored `toddle_student_id`, falling back
 * to the `sfa-<id>` sourceId lookup for students synced before the
 * Xano columns existed. Returns a short status string for logs; the
 * caller decides whether a failure matters (unenroll flows treat this
 * as best-effort — the portal-side archive already landed).
 */
export async function setToddleArchiveState(
  studentXanoId: number,
  storedToddleId: string | null | undefined,
  archived: boolean
): Promise<string> {
  if (!isToddleConfigured()) return "skipped — Toddle not configured";
  let toddleId = (storedToddleId ?? "").trim();
  if (!toddleId) {
    const matches = await getStudentsBySourceIds([`sfa-${studentXanoId}`]);
    toddleId = matches[0] ? String(matches[0].id) : "";
  }
  if (!toddleId) return "skipped — student has never been synced to Toddle";
  if (archived) {
    await archiveStudent(toddleId);
    return `archived Toddle student ${toddleId}`;
  }
  await unarchiveStudent(toddleId);
  return `unarchived Toddle student ${toddleId}`;
}

/** Pick a fetchable URL out of the Xano image-metadata blob on
 *  `student_photo` — `url` when present, else the public Xano base +
 *  `path`. Mirrors the client-side `resolveFileUrl` on the enrolled
 *  detail page. */
export function resolvePhotoUrl(photo: object | null | undefined): string | null {
  if (!photo || typeof photo !== "object") return null;
  const url = (photo as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (photo as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/** Download an image and return it as a raw base64 string (no
 *  data-URI prefix — Toddle's profileImageUpload takes the bare
 *  encoded bytes). Caps at 8MB so a mis-uploaded original can't
 *  blow up the request. */
async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`photo fetch failed (${res.status})`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`photo URL returned non-image content (${contentType})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const MAX_BYTES = 8 * 1024 * 1024;
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `photo too large to push (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 8MB)`
    );
  }
  return buffer.toString("base64");
}
