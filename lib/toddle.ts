/**
 * Toddle Open API client (V2.0 — Toddle 2.0 docs:
 * https://documenter.getpostman.com/view/48289859/2sBXiqF9SU).
 *
 * Used by the admin "Sync to Toddle" affordance on enrolled students
 * to push a student into the school's Toddle organization — updating
 * the existing Toddle student when one matches, creating one when
 * none does.
 *
 * Environment:
 *   TODDLE_API_TOKEN     — required. Bearer token issued by Toddle.
 *   TODDLE_API_BASE_URL  — optional. Full base URL (e.g.
 *                          https://us-east-1-production-apis.toddleapp.com).
 *   TODDLE_REGION        — optional alternative to the full URL; one of
 *                          Toddle's region slugs (us-east-1, eu-west-1,
 *                          eu-central-1, ap-southeast-1, ap-southeast-2,
 *                          ap-east-1, cn-north-1). Defaults to us-east-1.
 *   TODDLE_YEAR_GROUP_MAP — optional JSON object mapping our grade
 *                          labels to Toddle year-group ids, e.g.
 *                          {"9th":"289881578031554418"}. Takes
 *                          precedence over the automatic name match —
 *                          set it when the auto-match reports an
 *                          ambiguity.
 *   TODDLE_CURRICULUM_ID — optional. Scopes the year-group lookup to
 *                          one curriculum when the org has several.
 *
 * Matching strategy (see `upsertStudent`): we stamp every student we
 * create with `sourceId = "sfa-<xano student id>"`, so subsequent
 * syncs find them deterministically via the `sourceIds` filter on
 * GET /students. Students that already exist in Toddle from before
 * this integration won't carry our sourceId, so a name(+DOB) match
 * is the fallback — on that first update we write our sourceId onto
 * their Toddle record, making every later sync direct.
 */

import { stripNameSuffix } from "@/lib/name-suffix";

const DEFAULT_REGION = "us-east-1";

function getBaseUrl(): string {
  const explicit = process.env.TODDLE_API_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const region = process.env.TODDLE_REGION || DEFAULT_REGION;
  return `https://${region}-production-apis.toddleapp.com`;
}

function getToken(): string {
  const token = process.env.TODDLE_API_TOKEN;
  if (!token) throw new Error("TODDLE_API_TOKEN is not set");
  return token;
}

/** Graceful-degrade check — surfaces a clear "not configured" error
 *  from the API route instead of a raw missing-env throw. */
export function isToddleConfigured(): boolean {
  return Boolean(process.env.TODDLE_API_TOKEN);
}

/** Thrown for sync-blocking conditions the admin can fix (missing
 *  grade placement, ambiguous match, unmapped year group) — the API
 *  route surfaces `message` verbatim in the error toast. */
export class ToddleSyncError extends Error {}

async function toddleFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Toddle error ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types (subset of the fields the docs return — we only model what we read)
// ---------------------------------------------------------------------------

export interface ToddleStudent {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  grade?: string | null;
  yearGroup?: string | null;
  /** Year-group id — what the sync diff compares grade on, since
   *  `yearGroup` is a cohort label ("Batch of 2028") rather than the
   *  grade we push. */
  yearGroupId?: string | null;
  sourceId?: string | null;
  dob?: string | null;
  isArchived?: boolean;
  /** Echoed back on GET, so the sync can report exactly which profile
   *  fields a push changed. */
  gender?: string | null;
  phoneNumber?: string | null;
  /** ISO stamp ("2024-08-19T00:00:00") even though we push a plain
   *  YYYY-MM-DD — compared on the calendar day. */
  enrollmentDate?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  /** The student's crew, as Toddle REPORTS it. Toddle has no crew
   *  field of its own, so the org repurposed an extra profile slot and
   *  relabelled it "Crew" — which is why a field named for a name
   *  holds "Crew A".
   *
   *  It is written under a DIFFERENT name: `first_additional_field`
   *  (see `ToddleStudentBody`). Writing `first_name_locale` back is
   *  accepted with a 200 and silently discarded, so the two names are
   *  not interchangeable and the diff can't treat them as one key. */
  first_name_locale?: string | null;
  /** ISO stamp of when the record was made in Toddle. Only used to
   *  date a near-match in the duplicate prompt ("created 13 Mar"),
   *  which is often what tells an admin which of two records is the
   *  real one. */
  createdAt?: string | null;
}

export interface ToddleYearGroup {
  id: string;
  name: string;
  grades?: Array<{ id: string; name: string }>;
}

/** Body accepted by both POST /students and PUT /students/:id. All
 *  fields optional on update; create requires firstName, lastName and
 *  yearGroupId. Dates are `YYYY-MM-DD`; gender is `M` / `F` / `X`. */
export interface ToddleStudentBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  gender?: "M" | "F" | "X";
  dob?: string;
  sourceId?: string;
  yearGroupId?: string;
  phoneNumber?: string;
  enrollmentDate?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  /** Crew ("Crew B"). Toddle's extra profile slots are written as
   *  `first_additional_field` … `eighth_additional_field` but read
   *  back under their configured names — this one comes back as
   *  `first_name_locale`, which is the field the org labels "Crew".
   *  Writing to the name it reads back under is accepted with a 200
   *  and discarded, so it has to be this one. Verified live. */
  first_additional_field?: string;
}

/** One row from GET /public/v2/parents — a Toddle parent (family
 *  member) account. `children` carries the linked students. */
export interface ToddleParentRecord {
  id: number | string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  children?: Array<{ id: string; relationship?: string | null }>;
}

/** One row from GET /public/v2/contact-details/:studentId — the
 *  contact card shown on the Toddle student. */
export interface ToddleContactDetail {
  id: number | string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  relationship: string | null;
}

export interface ToddleCourse {
  id: string;
  title?: string | null;
  name?: string | null;
  isArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Raw endpoints
// ---------------------------------------------------------------------------

/** GET /public/v2/students filtered by sourceIds. The filter takes a
 *  JSON-array string (e.g. `sourceIds=["sfa-42"]`), per the docs'
 *  example request. */
export async function getStudentsBySourceIds(
  sourceIds: string[]
): Promise<ToddleStudent[]> {
  const query = encodeURIComponent(JSON.stringify(sourceIds));
  const data = await toddleFetch<{ response: { students: ToddleStudent[] } }>(
    `/public/v2/students?sourceIds=${query}`
  );
  return data.response?.students ?? [];
}

/** GET /public/v2/students — the full organization roster. Used only
 *  for the name(+DOB) fallback match on students that pre-date this
 *  integration and so don't carry our sourceId yet. */
export async function getAllStudents(): Promise<ToddleStudent[]> {
  const data = await toddleFetch<{ response: { students: ToddleStudent[] } }>(
    `/public/v2/students`
  );
  return data.response?.students ?? [];
}

export async function getYearGroups(): Promise<ToddleYearGroup[]> {
  const curriculumId = process.env.TODDLE_CURRICULUM_ID;
  const qs = curriculumId
    ? `?curriculumId=${encodeURIComponent(curriculumId)}`
    : "";
  const data = await toddleFetch<{
    response: { yearGroups: ToddleYearGroup[] };
  }>(`/public/v2/year-groups${qs}`);
  return data.response?.yearGroups ?? [];
}

export async function createStudent(
  body: ToddleStudentBody
): Promise<ToddleStudent> {
  const data = await toddleFetch<{ response: { student: ToddleStudent } }>(
    `/public/v2/students`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return data.response.student;
}

export async function updateStudent(
  id: string,
  body: ToddleStudentBody
): Promise<ToddleStudent> {
  const data = await toddleFetch<{ response: { student: ToddleStudent } }>(
    `/public/v2/students/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
  return data.response.student;
}

/** PUT /public/v2/students/:id/archive — flags the Toddle student as
 *  archived (hidden from active rosters; reversible). No body. */
export async function archiveStudent(id: string): Promise<void> {
  await toddleFetch(
    `/public/v2/students/${encodeURIComponent(id)}/archive`,
    { method: "PUT" }
  );
}

/** PUT /public/v2/students/:id/unarchive — restores an archived
 *  Toddle student to the active roster. No body. */
export async function unarchiveStudent(id: string): Promise<void> {
  await toddleFetch(
    `/public/v2/students/${encodeURIComponent(id)}/unarchive`,
    { method: "PUT" }
  );
}

/** PUT /public/v2/students/:id/profileImageUpload — replaces the
 *  student's Toddle profile photo. Body is a base64-encoded image
 *  string (raw base64, no data-URI prefix). Handled outside
 *  `toddleFetch` because the endpoint's success response isn't
 *  guaranteed to carry a JSON body. */
export async function uploadStudentProfileImage(
  id: string,
  base64Image: string
): Promise<void> {
  const res = await fetch(
    `${getBaseUrl()}/public/v2/students/${encodeURIComponent(id)}/profileImageUpload`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Image }),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Toddle profile-image error ${res.status}: ${text.slice(0, 500)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Parents (family member accounts), contact details, and classes
// ---------------------------------------------------------------------------

/** GET /public/v2/parents — every parent account in the org (the API
 *  has no email filter, so upserts match against this list). */
export async function getParents(): Promise<ToddleParentRecord[]> {
  const data = await toddleFetch<{ response: { parents: ToddleParentRecord[] } }>(
    `/public/v2/parents`
  );
  return data.response?.parents ?? [];
}

/** POST /public/v2/parents — email + children are required by Toddle. */
export async function createParent(body: {
  firstName: string;
  lastName: string;
  email: string;
  children: string[];
  relationships?: Array<{ childId: string; relationship: string }>;
}): Promise<ToddleParentRecord> {
  const data = await toddleFetch<{ response: { parent: ToddleParentRecord } }>(
    `/public/v2/parents`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return data.response.parent;
}

export async function updateParent(
  id: number | string,
  body: {
    firstName?: string;
    lastName?: string;
    email?: string;
    addedChildren?: string[];
    removedChildren?: string[];
    relationships?: Array<{ childId: string; relationship: string }>;
  }
): Promise<ToddleParentRecord> {
  const data = await toddleFetch<{ response: { parent: ToddleParentRecord } }>(
    `/public/v2/parents/${encodeURIComponent(String(id))}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
  return data.response.parent;
}

/** GET /public/v2/contact-details/:id — takes the TODDLE STUDENT id
 *  and returns that student's contact cards. */
export async function getContactDetails(
  studentToddleId: string
): Promise<ToddleContactDetail[]> {
  const data = await toddleFetch<{
    response: { contactDetails: ToddleContactDetail[] };
  }>(`/public/v2/contact-details/${encodeURIComponent(studentToddleId)}`);
  return data.response?.contactDetails ?? [];
}

export async function createContactDetail(body: {
  firstName: string;
  lastName: string;
  studentId: string;
  relationship: string;
  email?: string;
  phoneNumber?: string;
}): Promise<void> {
  await toddleFetch(`/public/v2/contact-details`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateContactDetail(
  id: number | string,
  body: {
    firstName?: string;
    lastName?: string;
    relationship?: string;
    email?: string;
    phoneNumber?: string;
  }
): Promise<void> {
  await toddleFetch(
    `/public/v2/contact-details/${encodeURIComponent(String(id))}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

export async function getCourses(): Promise<ToddleCourse[]> {
  const data = await toddleFetch<{ response: { courses: ToddleCourse[] } }>(
    `/public/v2/courses`
  );
  return data.response?.courses ?? [];
}

export async function getCourseStudentIds(
  courseId: string
): Promise<string[]> {
  const data = await toddleFetch<{
    response: { students: Array<{ id: number | string }> };
  }>(`/public/v2/courses/${encodeURIComponent(courseId)}/students`);
  return (data.response?.students ?? []).map((s) => String(s.id));
}

export async function addStudentsToCourse(
  courseId: string,
  studentIds: string[]
): Promise<void> {
  await toddleFetch(
    `/public/v2/courses/${encodeURIComponent(courseId)}/students/add`,
    { method: "PUT", body: JSON.stringify({ studentIds }) }
  );
}

export async function removeStudentsFromCourse(
  courseId: string,
  studentIds: string[]
): Promise<void> {
  await toddleFetch(
    `/public/v2/courses/${encodeURIComponent(courseId)}/students/remove`,
    { method: "PUT", body: JSON.stringify({ studentIds }) }
  );
}

// ---------------------------------------------------------------------------
// Family member + contact sync
// ---------------------------------------------------------------------------

/** One family member (a registration_parents row) as pushed to
 *  Toddle — becomes both a parent ACCOUNT (login, linked to the
 *  student) and a contact-details CARD (phone/email on the student). */
export interface ToddleFamilyMemberInput {
  firstName: string;
  lastName: string;
  /** Missing/invalid email ⇒ the parent ACCOUNT is skipped (Toddle
   *  requires email to create one); the contact card still syncs. */
  email?: string;
  phoneNumber?: string;
  /** e.g. "Mother" — defaults to "Guardian" on contact creation. */
  relationship?: string;
}

export interface ToddleFamilyMemberResult {
  name: string;
  /** created = new Toddle parent; linked = existing parent newly
   *  attached to this student; updated = already attached (name
   *  refreshed); skipped = no email to create an account with. */
  account: "created" | "linked" | "updated" | "skipped (no email)" | "failed";
  contact: "created" | "updated" | "failed";
  error?: string;
}

/**
 * Push the family's contacts onto a Toddle student: upsert each as a
 * parent account (matched org-wide by email) AND as a contact-details
 * card on the student (matched by email, falling back to name).
 * Per-member failures are reported, never thrown — one bad row
 * shouldn't undo the rest of the sync.
 *
 * `preloaded.parents` lets a bulk run fetch the org's parent list
 * once and share it across students; parents created here are pushed
 * back onto that array so a sibling synced later in the same run
 * matches them instead of double-creating.
 */
export async function syncFamilyMembers(
  studentToddleId: string,
  members: ToddleFamilyMemberInput[],
  preloaded?: { parents?: ToddleParentRecord[] }
): Promise<ToddleFamilyMemberResult[]> {
  if (members.length === 0) return [];
  const [allParents, existingContacts] = await Promise.all([
    preloaded?.parents ?? getParents(),
    getContactDetails(studentToddleId),
  ]);
  const results: ToddleFamilyMemberResult[] = [];

  for (const m of members) {
    const name = `${m.firstName} ${m.lastName}`.trim();
    const email = (m.email ?? "").trim().toLowerCase();
    const result: ToddleFamilyMemberResult = {
      name,
      account: "skipped (no email)",
      contact: "failed",
    };

    // 1. Parent account (Toddle requires an email to create one).
    if (email) {
      try {
        const existing = allParents.find(
          (p) => (p.email ?? "").trim().toLowerCase() === email
        );
        if (existing) {
          const alreadyLinked = (existing.children ?? []).some(
            (c) => String(c.id) === studentToddleId
          );
          await updateParent(existing.id, {
            firstName: m.firstName,
            lastName: m.lastName,
            ...(alreadyLinked
              ? {}
              : {
                  addedChildren: [studentToddleId],
                  ...(m.relationship
                    ? {
                        relationships: [
                          {
                            childId: studentToddleId,
                            relationship: m.relationship,
                          },
                        ],
                      }
                    : {}),
                }),
          });
          result.account = alreadyLinked ? "updated" : "linked";
        } else {
          const created = await createParent({
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email!.trim(),
            children: [studentToddleId],
            ...(m.relationship
              ? {
                  relationships: [
                    { childId: studentToddleId, relationship: m.relationship },
                  ],
                }
              : {}),
          });
          // Visible to later students in the same (bulk) run.
          allParents.push(created);
          result.account = "created";
        }
      } catch (err) {
        result.account = "failed";
        result.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
      }
    }

    // 2. Contact-details card on the student.
    try {
      const match = existingContacts.find((c) => {
        const cEmail = (c.email ?? "").trim().toLowerCase();
        if (email && cEmail) return cEmail === email;
        return (
          (c.firstName ?? "").trim().toLowerCase() ===
            m.firstName.trim().toLowerCase() &&
          (c.lastName ?? "").trim().toLowerCase() ===
            m.lastName.trim().toLowerCase()
        );
      });
      if (match) {
        await updateContactDetail(match.id, {
          firstName: m.firstName,
          lastName: m.lastName,
          ...(m.email?.trim() ? { email: m.email.trim() } : {}),
          ...(m.phoneNumber ? { phoneNumber: m.phoneNumber } : {}),
          // Only overwrite a relationship we actually know.
          ...(m.relationship ? { relationship: m.relationship } : {}),
        });
        result.contact = "updated";
      } else {
        await createContactDetail({
          firstName: m.firstName,
          lastName: m.lastName,
          studentId: studentToddleId,
          relationship: m.relationship || "Guardian",
          ...(m.email?.trim() ? { email: m.email.trim() } : {}),
          ...(m.phoneNumber ? { phoneNumber: m.phoneNumber } : {}),
        });
        result.contact = "created";
      }
    } catch (err) {
      result.contact = "failed";
      const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
      result.error = result.error ? `${result.error}; ${msg}` : msg;
    }

    results.push(result);
  }
  return results;
}

/**
 * Put the student in the Toddle class matching their crew — the org
 * mirrors our crews as classes titled "Crew A"–"Crew E". Also removes
 * them from any OTHER "Crew …" class so a crew move here moves them
 * there. Returns a short human status for the admin toast; throws
 * nothing (crew is best-effort, like the photo).
 *
 * `preloaded` lets a bulk run share one courses fetch and one roster
 * fetch per crew class across every student — rosters are kept
 * current in place as students are added/removed.
 */
export async function syncCrewClass(
  studentToddleId: string,
  crewName: string,
  preloaded?: {
    courses?: ToddleCourse[];
    /** courseId → student ids currently enrolled. Mutated on add/remove. */
    rosters?: Map<string, string[]>;
  }
): Promise<string> {
  try {
    const courses = (preloaded?.courses ?? (await getCourses())).filter(
      (c) => !c.isArchived
    );
    const titleOf = (c: ToddleCourse) => (c.title ?? c.name ?? "").trim();
    const want = crewName.trim().toLowerCase();
    const target = courses.find((c) => titleOf(c).toLowerCase() === want);
    if (!target) {
      return `no Toddle class titled "${crewName.trim()}"`;
    }
    const crewCourses = courses.filter((c) =>
      /^crew\b/i.test(titleOf(c))
    );
    const rosterOf = async (courseId: string): Promise<string[]> => {
      const cached = preloaded?.rosters?.get(courseId);
      if (cached) return cached;
      const ids = await getCourseStudentIds(courseId);
      preloaded?.rosters?.set(courseId, ids);
      return ids;
    };
    const notes: string[] = [];
    for (const course of crewCourses) {
      const ids = await rosterOf(course.id);
      const enrolled = ids.includes(studentToddleId);
      if (course.id === target.id) {
        if (enrolled) {
          notes.unshift(`already in ${titleOf(course)}`);
        } else {
          await addStudentsToCourse(course.id, [studentToddleId]);
          ids.push(studentToddleId);
          notes.unshift(`added to ${titleOf(course)}`);
        }
      } else if (enrolled) {
        await removeStudentsFromCourse(course.id, [studentToddleId]);
        ids.splice(ids.indexOf(studentToddleId), 1);
        notes.push(`removed from ${titleOf(course)}`);
      }
    }
    return notes.join(", ");
  } catch (err) {
    console.error(`[toddle.syncCrewClass] failed for "${crewName}":`, err);
    return "failed — see server logs";
  }
}

// ---------------------------------------------------------------------------
// Year-group resolution
// ---------------------------------------------------------------------------

/**
 * Map one of our grade labels ("8th" … "12th") to a Toddle
 * year-group id. `yearGroupId` is REQUIRED on student creation, so
 * this must resolve before we can create.
 *
 * Resolution order:
 *   1. `TODDLE_YEAR_GROUP_MAP` env JSON — explicit admin-configured
 *      mapping, wins outright.
 *   2. Automatic match — fetch the org's year groups and compare the
 *      numeric part of our label against the numeric part of each
 *      year group's grade names ("9th" ↔ "Grade 9"). Digit-string
 *      equality, so "Grade 1" never swallows "Grade 10".
 *
 * Exactly one auto-match is required — zero or several throws a
 * `ToddleSyncError` that lists what Toddle actually has, so the admin
 * can set the env map instead of us guessing wrong.
 */
export async function resolveYearGroupId(
  gradeLevel: string,
  /** Preloaded org year groups. A roster-wide preview resolves dozens
   *  of grades and must not fetch this list once per student — Toddle
   *  rate-limits long before that finishes. */
  preloaded?: ToddleYearGroup[]
): Promise<string> {
  const rawMap = process.env.TODDLE_YEAR_GROUP_MAP;
  if (rawMap) {
    try {
      const map = JSON.parse(rawMap) as Record<string, string>;
      const mapped = map[gradeLevel];
      if (mapped) return mapped;
    } catch {
      throw new ToddleSyncError(
        "TODDLE_YEAR_GROUP_MAP is set but isn't valid JSON."
      );
    }
  }

  const digits = gradeLevel.match(/\d+/)?.[0];
  if (!digits) {
    throw new ToddleSyncError(
      `Can't derive a numeric grade from "${gradeLevel}" — add it to TODDLE_YEAR_GROUP_MAP.`
    );
  }

  const yearGroups = preloaded ?? (await getYearGroups());
  const candidates = yearGroups.filter((yg) =>
    (yg.grades ?? []).some(
      (g) => (g.name ?? "").match(/\d+/)?.[0] === digits
    )
  );

  if (candidates.length === 1) return candidates[0].id;

  const describe = (list: ToddleYearGroup[]) =>
    list
      .map(
        (yg) =>
          `${yg.name} [${(yg.grades ?? []).map((g) => g.name).join(", ")}] (id ${yg.id})`
      )
      .join("; ");

  if (candidates.length === 0) {
    throw new ToddleSyncError(
      `No Toddle year group has a grade matching "${gradeLevel}". Available: ${
        describe(yearGroups) || "none"
      }. Set TODDLE_YEAR_GROUP_MAP to map it explicitly.`
    );
  }
  throw new ToddleSyncError(
    `Multiple Toddle year groups match "${gradeLevel}": ${describe(
      candidates
    )}. Set TODDLE_YEAR_GROUP_MAP (e.g. {"${gradeLevel}":"<yearGroupId>"}) to pick one.`
  );
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export interface ToddleSyncFields {
  /** Our stable identifier, stamped onto the Toddle record —
   *  `"sfa-<xano student id>"`. */
  sourceId: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, pre-validated by the caller. */
  dob?: string;
  gender?: "M" | "F" | "X";
  /** Digits only, as stored on the Xano student row. */
  phoneNumber?: string;
  /** Our grade label ("9th") — resolved to a yearGroupId here. */
  gradeLevel?: string;
  /** The generated school Google email — becomes the Toddle login. */
  email?: string;
  /** `YYYY-MM-DD`, pre-validated by the caller (start of the school
   *  year the student first enrolled in). */
  enrollmentDate?: string;
  /** Home address — sourced from the family's primary contact. */
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  /** Crew ("Crew B") from the student's packet. Crew lives in two
   *  places in Toddle — the "Crew …" class and a profile field — and
   *  only the class half was ever synced, so a crew move left the
   *  profile showing the old crew. */
  crew?: string;
}

export interface ToddleUpsertResult {
  /** `unchanged` means the record was pushed but every field Toddle
   *  reports back already matched — nothing about the profile moved.
   *  We still send the PUT (fields Toddle does NOT report back, like
   *  the address, would otherwise drift silently), so this is a
   *  statement about the comparable fields, not about the request. */
  action: "created" | "updated" | "unchanged";
  toddleId: string;
  /** How the existing record was found — `stored` (id we saved on the
   *  Xano row), `sourceId` (Toddle-side lookup), `email` (the school
   *  address we generated, which is unique in Toddle), or `name`
   *  (fallback for records pre-dating this integration). Null when
   *  created. */
  matchedBy: "stored" | "sourceId" | "email" | "name" | null;
  /** Which fields differed from what Toddle held, in our own field
   *  names ("email", "gradeLevel"). Empty when nothing visible changed
   *  or when the record was created. */
  changedFields: string[];
  /** False when we never saw the prior record (no preloaded roster
   *  entry on the direct-update path), so "unchanged" could not be
   *  determined and `action` falls back to `updated`. Lets callers say
   *  "updated" without implying anything actually differed. */
  compared: boolean;
  /** True when Toddle refused our sourceId because another (invisible,
   *  almost certainly archived) record already holds it. The profile
   *  still synced; the id just couldn't be stamped. */
  sourceIdBlocked?: boolean;
}

function normName(v: string | null | undefined): string {
  return stripNameSuffix(v).toLowerCase();
}

/** Fields we push that Toddle may echo back on a student record.
 *  Compared case-insensitively, trimmed; dates down to YYYY-MM-DD. */
const COMPARABLE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "dob",
  "gender",
  "phoneNumber",
  "enrollmentDate",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zipcode",
  // Crew is not here: Toddle writes and reads it under two different
  // names, so it can't be compared key-for-key. See below.
] as const;

function normValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  // Dates arrive as full ISO stamps on one side and YYYY-MM-DD on the
  // other; compare the calendar day only.
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s.toLowerCase();
}

/**
 * Which of the fields we're about to push actually differ from the
 * record Toddle currently holds.
 *
 * Only fields the existing record actually carries are compared — a
 * key Toddle doesn't echo back can't be diffed, and guessing "changed"
 * on absent keys would mark every student as updated forever.
 * `compared` reports whether any comparison was possible at all, so
 * callers never present "no changes" when they simply couldn't look.
 *
 * Grade is compared on the resolved `yearGroupId`, NOT on any label:
 * Toddle names its year groups by cohort ("Batch of 2028") while we
 * push "9th", so a label comparison would report a grade change on
 * every student on every run, forever.
 */
export function diffStudentFields(
  existing: ToddleStudent | null | undefined,
  body: ToddleStudentBody
): { changedFields: string[]; compared: boolean } {
  if (!existing) return { changedFields: [], compared: false };
  const record = existing as unknown as Record<string, unknown>;
  const changedFields: string[] = [];
  let compared = false;

  for (const key of COMPARABLE_FIELDS) {
    const next = (body as Record<string, unknown>)[key];
    if (next === undefined) continue; // not pushed this run
    if (!(key in record)) continue; // Toddle doesn't report it
    compared = true;
    if (normValue(record[key]) !== normValue(next)) changedFields.push(key);
  }

  // Crew. Pushed as `first_additional_field`, reported back by Toddle
  // as `first_name_locale` — the same slot under its configured name.
  // Compared across the two names and reported as "crew", which is
  // what the profile calls it and what an admin will look for.
  const nextCrew = (body as Record<string, unknown>).first_additional_field;
  if (nextCrew !== undefined && "first_name_locale" in record) {
    compared = true;
    if (normValue(record.first_name_locale) !== normValue(nextCrew)) {
      changedFields.push("crew");
    }
  }

  // Year group, by id. Reported under "gradeLevel" because that's the
  // field an admin recognizes.
  const nextYearGroupId = (body as Record<string, unknown>).yearGroupId;
  if (nextYearGroupId !== undefined && "yearGroupId" in record) {
    compared = true;
    if (normValue(record.yearGroupId) !== normValue(nextYearGroupId)) {
      changedFields.push("gradeLevel");
    }
  }

  return { changedFields, compared };
}

/** Name key for matching: generational suffix dropped, then case,
 *  spacing and punctuation removed. Toddle holds "Daiquan Carbart"
 *  where we hold "Dai'quan Carbart", and "Craig Mebane" where we hold
 *  "Craig Mebane Jr." — neither is a different child. */
function nameKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${stripNameSuffix(first)} ${stripNameSuffix(last)}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface ToddleRosterMatch {
  student: ToddleStudent;
  matchedBy: "email" | "name";
}

/**
 * Find a student on the Toddle roster that is definitely ours, when
 * neither the stored id nor our sourceId turned one up.
 *
 * Order matters:
 *
 *   1. School email. It is unique in Toddle and WE generate it, so a
 *      record holding it is our student — regardless of how their name
 *      or date of birth is spelled on Toddle's side. This tier exists
 *      because those two fields drift constantly ("Creary Jr.", a
 *      typo'd "Kavliauskas", two students whose DOBs got swapped), and
 *      every drift used to end as a create that Toddle rejected for a
 *      duplicate email — the sync failing on the very evidence that
 *      proved the record was already there.
 *   2. Name, ignoring case and punctuation, with dates of birth
 *      required to agree only when BOTH sides carry one. Several
 *      matches means twins or duplicates: return nothing and let the
 *      caller raise rather than guess.
 *
 * Archived records are preferred against only as a last resort — an
 * active record is always the better target.
 */
export function matchToddleStudent(
  roster: ToddleStudent[],
  fields: { firstName: string; lastName: string; dob?: string; email?: string }
): ToddleRosterMatch | null {
  const email = (fields.email ?? "").trim().toLowerCase();
  if (email) {
    const byEmail = roster.filter(
      (s) => (s.email ?? "").trim().toLowerCase() === email
    );
    const target = byEmail.find((s) => !s.isArchived) ?? byEmail[0];
    if (target) return { student: target, matchedBy: "email" };
  }

  const key = nameKey(fields.firstName, fields.lastName);
  let matches = roster.filter((s) => nameKey(s.firstName, s.lastName) === key);
  if (matches.length > 1) {
    const active = matches.filter((s) => !s.isArchived);
    if (active.length >= 1) matches = active;
  }
  // Date of birth breaks a TIE — it never eliminates the only
  // candidate. The apply portal is the source of truth for a birthday,
  // so a date that disagrees with Toddle's is drift for this sync to
  // correct, not evidence of a different child. Treating it as a
  // filter is what sent Ava Young down the create path.
  if (matches.length > 1 && fields.dob) {
    const byDob = matches.filter(
      (s) => (s.dob ?? "").slice(0, 10) === fields.dob
    );
    if (byDob.length === 1) return { student: byDob[0], matchedBy: "name" };
  }
  if (matches.length === 1) return { student: matches[0], matchedBy: "name" };
  return null;
}

/* ────────────────── Near-matches, before a create ───────────────── */

export interface ToddleDuplicateCandidate {
  toddleId: string;
  name: string;
  email: string | null;
  dob: string | null;
  createdAt: string | null;
  /** Toddle's own id for the record ("TD-…" when it predates us). */
  sourceId: string | null;
  /** Why this looks like the same child, in words. */
  reason: string;
}

/** Thrown instead of creating, when the roster holds a near-match.
 *  Carries the candidates so the caller can offer a choice rather
 *  than just an error. */
export class ToddleDuplicateError extends ToddleSyncError {
  readonly candidates: ToddleDuplicateCandidate[];
  constructor(message: string, candidates: ToddleDuplicateCandidate[]) {
    super(message);
    this.candidates = candidates;
  }
}

/** One name part, reduced to letters and digits for comparison —
 *  suffix already gone via `stripNameSuffix`. */
function bareName(v: string | null | undefined): string {
  return stripNameSuffix(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Stem of a generated school address: "ajani.alvelo25@…" → "ajani.alvelo". */
function emailStem(v: string | null | undefined): string {
  const local = (v ?? "").toLowerCase().split("@")[0] ?? "";
  return local.replace(/\d+$/, "").replace(/[^a-z.]/g, "");
}

/**
 * Records on the roster that look like the student we're about to
 * create — run only when every strict matcher has already missed.
 *
 * The strict matchers (sourceId → school email → name) share a blind
 * spot: the school email is DERIVED from the name, so one spelling
 * difference breaks both fallbacks at once and the sync creates a
 * second record for a child Toddle already has. That is exactly how
 * "Ajani Welch 'Alvelo" landed beside "Ajani Alvelo". Generational
 * suffixes used to do the same and no longer can — `stripNameSuffix`
 * removes them from the name AND the generated email — so what's left
 * here is the drift no rule can normalise away.
 *
 * These rules are deliberately loose — a false positive costs one
 * click, a false negative costs a duplicate someone has to merge by
 * hand — but never so loose that siblings or twins trip them: every
 * rule requires the FIRST name (or the email stem) to line up, so
 * Ryker and Rook Alessi, and the two Powells who share a birthday,
 * stay clear of each other.
 *
 * Archived Toddle records are NOT on the roster and so can't be
 * caught here; the create's own error path names that case.
 */
export function findDuplicateCandidates(
  roster: ToddleStudent[],
  fields: ToddleSyncFields
): ToddleDuplicateCandidate[] {
  const first = bareName(fields.firstName);
  const last = bareName(fields.lastName);
  const stem = emailStem(fields.email);
  const dob = (fields.dob ?? "").slice(0, 10);

  const found: ToddleDuplicateCandidate[] = [];
  for (const r of roster) {
    const rFirst = bareName(r.firstName);
    const rLast = bareName(r.lastName);
    const rStem = emailStem(r.email);
    const rDob = (r.dob ?? "").slice(0, 10);
    let reason = "";

    if (
      first &&
      first === rFirst &&
      last &&
      rLast &&
      (rLast.includes(last) || last.includes(rLast))
    ) {
      reason = "same first name, last name spelled differently";
    } else if (
      dob &&
      rDob === dob &&
      last &&
      last === rLast &&
      first.slice(0, 3) === rFirst.slice(0, 3)
    ) {
      reason = "same last name and date of birth, first name spelled differently";
    } else if (
      stem &&
      rStem &&
      (stem === rStem || stem.includes(rStem) || rStem.includes(stem))
    ) {
      reason = "nearly the same school email";
    }

    if (!reason) continue;
    found.push({
      toddleId: String(r.id),
      name: `${(r.firstName ?? "").trim()} ${(r.lastName ?? "").trim()}`.trim(),
      email: r.email ?? null,
      dob: rDob || null,
      createdAt: r.createdAt ?? null,
      sourceId: r.sourceId ?? null,
      reason,
    });
  }
  return found.slice(0, 3);
}

/**
 * Update-or-create a Toddle student.
 *
 *   1. `knownToddleId` (persisted on the Xano row from a prior sync)
 *      → direct PUT. A 404 here (record deleted in Toddle) falls
 *      through to the lookup path rather than failing the sync.
 *   2. Lookup by our sourceId → PUT.
 *   3. Fallback: scan the roster for a first+last name match (and DOB
 *      when both sides have one). Exactly one match → PUT, which also
 *      stamps our sourceId onto the record so the next sync is direct.
 *      Several matches → ToddleSyncError (never guess between twins).
 *   4. Nothing found → check the roster for a NEAR-match first
 *      (`findDuplicateCandidates`). One exists → `ToddleDuplicateError`
 *      rather than a create, because a wrongly-created record is the
 *      only outcome here that can't be fixed by syncing again. Pass
 *      `opts.allowCreate` once an admin has said it's a different
 *      child. Otherwise → POST create, which requires the grade level
 *      to resolve to a year group.
 */
/** The exact PUT/POST body a set of sync fields turns into. Exported
 *  so the pre-sync preview diffs the same payload the sync sends,
 *  rather than a hand-rolled approximation of it. */
export function toStudentBody(fields: ToddleSyncFields): ToddleStudentBody {
  const body: ToddleStudentBody = {
    firstName: fields.firstName,
    lastName: fields.lastName,
    sourceId: fields.sourceId,
  };
  if (fields.dob) body.dob = fields.dob;
  if (fields.gender) body.gender = fields.gender;
  if (fields.phoneNumber) body.phoneNumber = fields.phoneNumber;
  if (fields.email) body.email = fields.email;
  if (fields.enrollmentDate) body.enrollmentDate = fields.enrollmentDate;
  if (fields.addressLine1) body.addressLine1 = fields.addressLine1;
  if (fields.addressLine2) body.addressLine2 = fields.addressLine2;
  if (fields.city) body.city = fields.city;
  if (fields.state) body.state = fields.state;
  if (fields.zipcode) body.zipcode = fields.zipcode;
  if (fields.crew) body.first_additional_field = fields.crew;
  return body;
}

/**
 * PUT a student, tolerating a sourceId that Toddle says is taken.
 *
 * Toddle enforces sourceId uniqueness across ALL records including
 * archived ones, and its lookups return only active ones — so a
 * student whose old profile was archived leaves a ghost holding
 * "sfa-<id>". Stamping that id onto their live record is then rejected
 * outright, and the whole sync for that student used to die on it even
 * though every other field was ready to write.
 *
 * On that specific rejection we retry once WITHOUT the sourceId: the
 * profile still gets every field we hold, and the caller persists the
 * matched Toddle id on our side so the next sync addresses the record
 * directly and never needs the sourceId again. The ghost is reported
 * rather than worked around silently — someone still has to delete it
 * in Toddle.
 */
async function updateStudentTolerantOfSourceId(
  id: string,
  body: ToddleStudentBody
): Promise<{ student: ToddleStudent; sourceIdBlocked: boolean }> {
  try {
    return { student: await updateStudent(id, body), sourceIdBlocked: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isSourceIdConflict =
      /already exists/i.test(message) && /sourceid/i.test(message);
    if (!isSourceIdConflict || body.sourceId === undefined) throw err;
    const withoutSourceId: ToddleStudentBody = { ...body };
    delete withoutSourceId.sourceId;
    return {
      student: await updateStudent(id, withoutSourceId),
      sourceIdBlocked: true,
    };
  }
}

export async function upsertStudent(
  fields: ToddleSyncFields,
  knownToddleId?: string,
  /** The record Toddle currently holds, when the caller already has it
   *  (the bulk run preloads the whole roster). Only used to report
   *  what changed — never to decide whether to write. */
  existing?: ToddleStudent | null,
  opts?: {
    /** Create even though the roster holds a near-match. Set only
     *  when an admin has looked at the candidates and said this is a
     *  different child. */
    allowCreate?: boolean;
  }
): Promise<ToddleUpsertResult> {
  const body = toStudentBody(fields);

  // Keep the Toddle grade current on updates too — but a resolution
  // failure only blocks creation (where yearGroupId is required);
  // updates proceed without it.
  let yearGroupId: string | undefined;
  let yearGroupError: ToddleSyncError | undefined;
  if (fields.gradeLevel) {
    try {
      yearGroupId = await resolveYearGroupId(fields.gradeLevel);
    } catch (err) {
      if (err instanceof ToddleSyncError) yearGroupError = err;
      else throw err;
    }
  }
  const updateBody: ToddleStudentBody = yearGroupId
    ? { ...body, yearGroupId }
    : body;

  // 1. Direct update via the id we stored on the Xano row.
  if (knownToddleId) {
    try {
      const diff = diffStudentFields(existing, updateBody);
      const updated = await updateStudent(knownToddleId, updateBody);
      return {
        action:
          diff.compared && diff.changedFields.length === 0
            ? "unchanged"
            : "updated",
        toddleId: updated.id ?? knownToddleId,
        matchedBy: "stored",
        ...diff,
      };
    } catch (err) {
      // Stale id (deleted on Toddle's side) → fall through and re-match.
      console.warn(
        `[toddle.upsertStudent] stored id ${knownToddleId} failed, re-matching:`,
        err
      );
    }
  }

  // 2. Lookup by sourceId.
  const bySource = await getStudentsBySourceIds([fields.sourceId]);
  if (bySource.length > 0) {
    const target = bySource.find((s) => !s.isArchived) ?? bySource[0];
    const diff = diffStudentFields(target, updateBody);
    const { student: updated, sourceIdBlocked } =
      await updateStudentTolerantOfSourceId(target.id, updateBody);
    return {
      action:
        diff.compared && diff.changedFields.length === 0
          ? "unchanged"
          : "updated",
      toddleId: updated.id ?? target.id,
      matchedBy: "sourceId",
      sourceIdBlocked,
      ...diff,
    };
  }

  // 3. Email, then name(+DOB), against the roster — see
  //    `matchToddleStudent`. Updating what we find also stamps our
  //    sourceId onto it, so the next sync goes straight to step 1.
  const roster = await getAllStudents();
  const rosterMatch = matchToddleStudent(roster, fields);
  if (rosterMatch) {
    const diff = diffStudentFields(rosterMatch.student, updateBody);
    const { student: updated, sourceIdBlocked } =
      await updateStudentTolerantOfSourceId(
        rosterMatch.student.id,
        updateBody
      );
    return {
      action:
        diff.compared && diff.changedFields.length === 0
          ? "unchanged"
          : "updated",
      toddleId: updated.id ?? rosterMatch.student.id,
      matchedBy: rosterMatch.matchedBy === "email" ? "email" : "name",
      sourceIdBlocked,
      ...diff,
    };
  }
  const ambiguous = roster.filter(
    (s) =>
      normName(s.firstName) === normName(fields.firstName) &&
      normName(s.lastName) === normName(fields.lastName)
  );
  if (ambiguous.length > 1) {
    throw new ToddleSyncError(
      `${fields.firstName} ${fields.lastName} matches ${ambiguous.length} students in Toddle — set the sourceId "${fields.sourceId}" on the right one in Toddle, then sync again.`
    );
  }

  // 4. Create — but never blindly. A near-match on the roster means
  //    Toddle most likely already holds this child under a different
  //    spelling, and creating is the one outcome re-running the sync
  //    can't undo: the second record has to be merged by hand in
  //    Toddle. So we stop and hand the decision back.
  const candidates = findDuplicateCandidates(roster, fields);
  if (candidates.length > 0 && !opts?.allowCreate) {
    throw new ToddleDuplicateError(
      `${fields.firstName} ${fields.lastName} looks like ${
        candidates.length === 1 ? "a student" : "students"
      } Toddle already has — ${candidates
        .map((c) => `${c.name} (${c.reason})`)
        .join("; ")}. Link them to that record, or choose "Create new anyway".`,
      candidates
    );
  }

  if (!fields.gradeLevel) {
    throw new ToddleSyncError(
      "Student doesn't exist in Toddle yet, and creating one needs a grade level — set it in the Placement card first."
    );
  }
  if (!yearGroupId) {
    throw (
      yearGroupError ??
      new ToddleSyncError(
        `Couldn't resolve a Toddle year group for "${fields.gradeLevel}".`
      )
    );
  }
  const created = await createStudent({ ...body, yearGroupId }).catch(
    (err: unknown) => {
      // Toddle enforces uniqueness on sourceId and email, and its list
      // endpoints do not return archived students — so a create can
      // collide with a record we were never shown. Say that plainly
      // instead of surfacing a bare 400.
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        throw new ToddleSyncError(
          `Toddle refused to create ${fields.firstName} ${fields.lastName}: ${
            /sourceId/i.test(message)
              ? `a hidden record already uses the id "${fields.sourceId}" — it is most likely archived in Toddle, since archived students don't appear in any lookup. Unarchive or delete it there, then sync again.`
              : `a hidden record already uses ${fields.email ?? "this email"} — it is most likely archived in Toddle. Unarchive or delete it there, then sync again.`
          }`
        );
      }
      throw err;
    }
  );
  return {
    action: "created",
    toddleId: created.id,
    matchedBy: null,
    changedFields: [],
    compared: true,
  };
}
