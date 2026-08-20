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
  sourceId?: string | null;
  dob?: string | null;
  isArchived?: boolean;
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
 */
export async function syncFamilyMembers(
  studentToddleId: string,
  members: ToddleFamilyMemberInput[]
): Promise<ToddleFamilyMemberResult[]> {
  if (members.length === 0) return [];
  const [allParents, existingContacts] = await Promise.all([
    getParents(),
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
          await createParent({
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
 */
export async function syncCrewClass(
  studentToddleId: string,
  crewName: string
): Promise<string> {
  try {
    const courses = (await getCourses()).filter((c) => !c.isArchived);
    const titleOf = (c: ToddleCourse) => (c.title ?? c.name ?? "").trim();
    const want = crewName.trim().toLowerCase();
    const target = courses.find((c) => titleOf(c).toLowerCase() === want);
    if (!target) {
      return `no Toddle class titled "${crewName.trim()}"`;
    }
    const crewCourses = courses.filter((c) =>
      /^crew\b/i.test(titleOf(c))
    );
    const notes: string[] = [];
    for (const course of crewCourses) {
      const ids = await getCourseStudentIds(course.id);
      const enrolled = ids.includes(studentToddleId);
      if (course.id === target.id) {
        if (enrolled) {
          notes.unshift(`already in ${titleOf(course)}`);
        } else {
          await addStudentsToCourse(course.id, [studentToddleId]);
          notes.unshift(`added to ${titleOf(course)}`);
        }
      } else if (enrolled) {
        await removeStudentsFromCourse(course.id, [studentToddleId]);
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
export async function resolveYearGroupId(gradeLevel: string): Promise<string> {
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

  const yearGroups = await getYearGroups();
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
}

export interface ToddleUpsertResult {
  action: "created" | "updated";
  toddleId: string;
  /** How the existing record was found — `stored` (id we saved on the
   *  Xano row), `sourceId` (Toddle-side lookup), or `name` (fallback
   *  match for pre-integration records). Null when created. */
  matchedBy: "stored" | "sourceId" | "name" | null;
}

function normName(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
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
 *   4. Nothing found → POST create, which requires the grade level to
 *      resolve to a year group.
 */
export async function upsertStudent(
  fields: ToddleSyncFields,
  knownToddleId?: string
): Promise<ToddleUpsertResult> {
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
      const updated = await updateStudent(knownToddleId, updateBody);
      return { action: "updated", toddleId: updated.id ?? knownToddleId, matchedBy: "stored" };
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
    const updated = await updateStudent(target.id, updateBody);
    return { action: "updated", toddleId: updated.id ?? target.id, matchedBy: "sourceId" };
  }

  // 3. Name(+DOB) fallback for pre-integration Toddle records.
  const roster = await getAllStudents();
  let matches = roster.filter(
    (s) =>
      normName(s.firstName) === normName(fields.firstName) &&
      normName(s.lastName) === normName(fields.lastName) &&
      (!fields.dob || !s.dob || s.dob.slice(0, 10) === fields.dob)
  );
  if (matches.length > 1) {
    const active = matches.filter((s) => !s.isArchived);
    if (active.length >= 1) matches = active;
  }
  if (matches.length === 1) {
    const updated = await updateStudent(matches[0].id, updateBody);
    return { action: "updated", toddleId: updated.id ?? matches[0].id, matchedBy: "name" };
  }
  if (matches.length > 1) {
    throw new ToddleSyncError(
      `${fields.firstName} ${fields.lastName} matches ${matches.length} students in Toddle — set the sourceId "${fields.sourceId}" on the right one in Toddle, then sync again.`
    );
  }

  // 4. Create.
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
  const created = await createStudent({ ...body, yearGroupId });
  return { action: "created", toddleId: created.id, matchedBy: null };
}
