import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoEmergencyContact,
  XanoFamily,
  XanoParent,
  XanoStudent,
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
    ] = await Promise.allSettled([
      xano.families.getById(familyId),
      xano.students.getByFamilyId(familyId),
      xano.emergencyContacts.getByFamilyId(familyId),
      xano.applications.getByFamilyId(familyId),
      xano.parents.getAll(),
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
    } satisfies AdminFamilyOverviewResponse);
  } catch (err) {
    return handleAdminError(err);
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
}
