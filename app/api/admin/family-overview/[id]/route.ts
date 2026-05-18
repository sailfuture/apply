import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoEmergencyContact,
  XanoFamily,
  XanoFamilyApplicationProgress,
  XanoInquiry,
  XanoParent,
  XanoSchoolYear,
  XanoStudent,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/**
 * Admin family overview — one composite fetch that bundles
 * everything about a family across every school year:
 *
 *   - Family row (name)
 *   - Parents (full bio + contact info, lowest-id-first)
 *   - Students (all years, including archived/unenrolled)
 *   - Emergency contacts (family-evergreen, not year-scoped)
 *   - Applications (every year the family has applied — gives the
 *     overview surface the per-year lifecycle context)
 *   - Inquiries — every `registration_inquiry` row whose
 *     `primary_email` matches ANY parent email on this family
 *     (the inquiry side only records a primary; we match against
 *     all family parents so secondary-contact inquiries still show
 *     up). Lets admin see the pre-application funnel touchpoints
 *     without bouncing to /admin/inquiries.
 *   - Application progress + registration progress rows — per-year
 *     bridge rows for the family, joined with school-year metadata
 *     so the overview can render "Applied for 2026/2027 · Accepted"
 *     and "Registration confirmed for 2026/2027" without a second
 *     fetch.
 *   - School years — id → year_name map so the UI can label per-year
 *     rows without needing a separate fetch.
 *
 * Distinct from `/api/admin/families/[id]` which returns just the
 * raw family row, and `/api/admin/family-applications` which is
 * year-scoped. This is the "show me everything about this family,
 * across every cycle" view that backs the family overview page.
 *
 * Each lookup is wrapped in `Promise.allSettled` so a single Xano
 * hiccup degrades gracefully rather than 500'ing the whole route.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      );
    }

    const [
      familyResult,
      studentsResult,
      contactsResult,
      appsResult,
      parentsAllResult,
      inquiriesResult,
      appProgressResult,
      regProgressResult,
      schoolYearsResult,
    ] = await Promise.allSettled([
      xano.families.getById(familyId),
      xano.students.getByFamilyId(familyId),
      xano.emergencyContacts.getByFamilyId(familyId),
      xano.applications.getByFamilyId(familyId),
      xano.parents.getAll(),
      xano.inquiries.getAll(),
      fetchFamilyApplicationProgress(familyId),
      fetchStudentRegistrationProgress(familyId),
      xano.schoolYears.getAll(),
    ]);

    if (familyResult.status === "rejected") {
      console.error(
        "[/api/admin/family-overview] failed to load family:",
        familyResult.reason
      );
      return NextResponse.json(
        { error: "Family not found" },
        { status: 404 }
      );
    }
    const family: XanoFamily = familyResult.value;
    const students: XanoStudent[] =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const emergencyContacts: XanoEmergencyContact[] =
      contactsResult.status === "fulfilled" ? contactsResult.value : [];
    const applications: XanoApplication[] =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const parentsAll: XanoParent[] =
      parentsAllResult.status === "fulfilled" ? parentsAllResult.value : [];
    const inquiriesAll: XanoInquiry[] =
      inquiriesResult.status === "fulfilled" ? inquiriesResult.value : [];
    const appProgressRows: XanoFamilyApplicationProgress[] =
      appProgressResult.status === "fulfilled"
        ? appProgressResult.value
        : [];
    const regProgressRows: XanoStudentRegistrationProgress[] =
      regProgressResult.status === "fulfilled"
        ? regProgressResult.value
        : [];
    const schoolYears: XanoSchoolYear[] =
      schoolYearsResult.status === "fulfilled" ? schoolYearsResult.value : [];

    // Parents: filter the global parents list to this family's ids.
    // `getEmbeddedParents` extracts the full objects from the
    // family's nested `registration_parents_id` addon when present;
    // fall back to the full-list filter if the family row only
    // carries id references (some Xano queries return scalars).
    const parentIds = xano.families.getParentIds(family);
    let parents = xano.families.getEmbeddedParents(family);
    if (parents.length === 0 && parentIds.length > 0) {
      parents = parentsAll.filter((p) => parentIds.includes(p.id));
    }
    parents.sort((a, b) => a.id - b.id);

    // Drop "orphan" student rows from the overview — students
    // attached to the family record but who never had an
    // application created (across any year). They sometimes get
    // added as test data or via partial imports, and surfacing
    // them under a family they never actually applied to is
    // misleading. Cross-references the applications fetch above
    // so we don't need a separate query.
    const studentIdsWithApps = new Set<number>();
    for (const a of applications) {
      studentIdsWithApps.add(Number(a.registration_students_id));
    }
    const visibleStudents = students.filter((s) =>
      studentIdsWithApps.has(s.id)
    );

    // Inquiries — match `primary_email` (the only email field on
    // an inquiry row) against EVERY parent email on the family, so
    // an inquiry submitted by a secondary parent still surfaces.
    // Case-insensitive + trimmed since the inquiry form's input and
    // the parent-record email may come from different sources.
    const parentEmailSet = new Set(
      parents
        .map((p) => p.email?.trim().toLowerCase())
        .filter((e): e is string => typeof e === "string" && e.length > 0)
    );
    const matchedInquiries: XanoInquiry[] = parentEmailSet.size
      ? inquiriesAll
          .filter((i) => {
            const e = i.primary_email?.trim().toLowerCase();
            return !!e && parentEmailSet.has(e);
          })
          // Newest inquiry first so admin sees the most-recent
          // touchpoint at the top of the list.
          .sort((a, b) => b.created_at - a.created_at)
      : [];

    // School year lookup map — UI uses it to label every year-scoped
    // row (applications, application progress, registration progress)
    // without needing its own fetch.
    const schoolYearById = new Map<number, XanoSchoolYear>();
    for (const y of schoolYears) {
      schoolYearById.set(y.id, y);
    }

    return NextResponse.json({
      family: {
        id: family.id,
        family_name: family.family_name ?? "",
        created_at: family.created_at,
      },
      parents,
      students: visibleStudents,
      emergency_contacts: emergencyContacts,
      applications,
      // Newest first across all per-year arrays.
      application_progress: [...appProgressRows].sort(
        (a, b) => b.registration_school_years_id - a.registration_school_years_id
      ),
      registration_progress: [...regProgressRows].sort(
        (a, b) => b.registration_school_years_id - a.registration_school_years_id
      ),
      inquiries: matchedInquiries,
      school_years: Object.fromEntries(
        schoolYears.map((y) => [y.id, y.year_name])
      ),
    } satisfies AdminFamilyOverviewResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Direct fetch for every `registration_family_application_progress`
 *  row attached to a family. No dedicated `xano.familyApplicationProgress`
 *  by-family helper today, so we hit the table's CRUD endpoint with
 *  the FK as a query param. Same defensive-filter pattern used in
 *  `emergencyContacts.getByFamilyId` since some Xano environments
 *  don't honor query-param filtering and return the full table. */
async function fetchFamilyApplicationProgress(
  familyId: number
): Promise<XanoFamilyApplicationProgress[]> {
  try {
    const base = process.env.XANO_API_BASE_URL ?? "";
    const res = await fetch(
      `${base}/registration_family_application_progress?registration_families_id=${familyId}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const results = await res.json();
    if (!Array.isArray(results)) return [];
    return (results as XanoFamilyApplicationProgress[]).filter(
      (r) => Number(r.registration_families_id) === familyId
    );
  } catch (err) {
    console.error(
      `[/api/admin/family-overview] fetchFamilyApplicationProgress threw for familyId=${familyId}:`,
      err
    );
    return [];
  }
}

/** Direct fetch for every `registration_student_registration_progress`
 *  row attached to a family. Same pattern as the helper above; no
 *  dedicated by-family CRUD helper today. */
async function fetchStudentRegistrationProgress(
  familyId: number
): Promise<XanoStudentRegistrationProgress[]> {
  try {
    const base = process.env.XANO_API_BASE_URL ?? "";
    const res = await fetch(
      `${base}/registration_student_registration_progress?registration_families_id=${familyId}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const results = await res.json();
    if (!Array.isArray(results)) return [];
    return (results as XanoStudentRegistrationProgress[]).filter(
      (r) => Number(r.registration_families_id) === familyId
    );
  } catch (err) {
    console.error(
      `[/api/admin/family-overview] fetchStudentRegistrationProgress threw for familyId=${familyId}:`,
      err
    );
    return [];
  }
}

export interface AdminFamilyOverviewResponse {
  family: {
    id: number;
    family_name: string;
    created_at: number;
  };
  parents: XanoParent[];
  students: XanoStudent[];
  emergency_contacts: XanoEmergencyContact[];
  applications: XanoApplication[];
  /** Per-year family-application progress rows — one row per year
   *  the family touched the apply flow. Sorted newest year first. */
  application_progress: XanoFamilyApplicationProgress[];
  /** Per-year registration progress rows — one row per year the
   *  family touched the post-acceptance registration flow. Sorted
   *  newest year first. */
  registration_progress: XanoStudentRegistrationProgress[];
  /** Inquiries matched against any parent email on the family
   *  (primary OR secondary). Sorted newest first. */
  inquiries: XanoInquiry[];
  /** Lookup map of `school_years[yearId] = year_name`. Empty object
   *  if the school-years fetch fell over. */
  school_years: Record<string, string>;
}
