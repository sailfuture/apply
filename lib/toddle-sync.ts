import { xano } from "@/lib/xano";
import type {
  XanoFamily,
  XanoParent,
  XanoSchoolYear,
  XanoStudent,
} from "@/lib/xano";
import {
  upsertStudent,
  uploadStudentProfileImage,
  syncFamilyMembers,
  syncCrewClass,
  getParents,
  getCourses,
  getCourseStudentIds,
  getAllStudents,
  ToddleSyncError,
} from "@/lib/toddle";
import type {
  ToddleCourse,
  ToddleFamilyMemberInput,
  ToddleFamilyMemberResult,
  ToddleParentRecord,
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
    shared.toddleIdBySource = new Map(
      roster
        .filter((s) => (s.sourceId ?? "").startsWith("sfa-") && !s.isArchived)
        .map((s) => [s.sourceId as string, String(s.id)])
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
  shared: ToddleSyncShared
): Promise<ToddleStudentSyncOutcome> {
  const id = student.id;
  const firstName = (student.first_name ?? "").trim();
  const lastName = (student.last_name ?? "").trim();
  if (!firstName || !lastName) {
    throw new ToddleSyncError(
      "Student needs both a first and last name to sync."
    );
  }

  // Only pass fields that survive Toddle's validations: DOB must be
  // YYYY-MM-DD, gender must map onto M/F, phone must be the canonical
  // 10-digit form. Anything else is simply omitted.
  const dobRaw = (student.date_of_birth ?? "").trim();
  const dob = /^\d{4}-\d{2}-\d{2}/.test(dobRaw) ? dobRaw.slice(0, 10) : undefined;
  const gender =
    student.gender === "Male"
      ? ("M" as const)
      : student.gender === "Female"
        ? ("F" as const)
        : undefined;
  const phone = (student.student_phone ?? "").trim();
  const phoneNumber = /^\d{10}$/.test(phone) ? phone : undefined;

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

  // School email → Toddle login email (only when it looks like one).
  const schoolEmail = (student.school_email ?? "").trim();
  const email = /@/.test(schoolEmail) ? schoolEmail : undefined;

  // Enrollment date = start of the school year the student first
  // enrolled in (the School Account card's year pick).
  const enrollmentYear = shared.years.find(
    (y) => y.id === Number(student.enrollment_school_years_id)
  );
  const startRaw = (enrollmentYear?.start_date ?? "").trim();
  const enrollmentDate = /^\d{4}-\d{2}-\d{2}/.test(startRaw)
    ? startRaw.slice(0, 10)
    : undefined;

  // Home address — the primary contact's address on file.
  const addr = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : undefined;
  };

  const sourceId = `sfa-${id}`;
  const knownToddleId =
    student.toddle_student_id || shared.toddleIdBySource?.get(sourceId);

  const result = await upsertStudent(
    {
      sourceId,
      firstName,
      lastName,
      dob,
      gender,
      phoneNumber,
      gradeLevel:
        (gradeLevelHint ?? "").trim() ||
        (packet?.grade_level ?? "").trim() ||
        undefined,
      email,
      enrollmentDate,
      addressLine1: addr(primaryParent?.address_line_1),
      addressLine2: addr(primaryParent?.address_line_2),
      city: addr(primaryParent?.city),
      state: addr(primaryParent?.state),
      zipcode: addr(primaryParent?.zipcode),
    },
    knownToddleId || undefined
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
      const memberEmail = (p.email ?? "").trim();
      return {
        firstName: p.first_name.trim(),
        lastName: p.last_name.trim(),
        email: /@/.test(memberEmail) ? memberEmail : undefined,
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
