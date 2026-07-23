import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Ownership guard for mutations on Opportunity Scholarship child rows
 * (contributing members, homes, vehicles, benefits).
 *
 * The single-update / single-delete routes under `/api/scholarship-items/*`
 * are shared by BOTH the parent apply flow (a parent editing their own
 * application) and the admin family-detail cleanup, so the mutation is
 * allowed when:
 *
 *   - the caller is an admin (may touch any family's scholarship), OR
 *   - the child row's parent scholarship belongs to the caller's own
 *     family.
 *
 * Previously those routes only checked `auth()` (logged-in), so any
 * authenticated user could delete or edit another family's rows by
 * iterating the numeric item id (IDOR). The caller resolves the item ->
 * parent-scholarship id (via the item's `getById`) and passes it here.
 *
 * Returns a `NextResponse` to return early (401 / 403 / 404) when the
 * mutation is NOT allowed, or `null` when it is.
 */
export async function denyScholarshipMutation(
  scholarshipId: number | null | undefined
): Promise<NextResponse | null> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeof scholarshipId !== "number" || !Number.isFinite(scholarshipId)) {
    // No resolvable parent scholarship — 404 rather than leaking whether
    // the id exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Admins may touch any family's scholarship.
  const admin = await getCurrentAdmin();
  if (admin) return null;

  // Parents may only touch their own family's scholarship. Resolve the
  // scholarship's family and the caller's family, then compare.
  const [scholarship, parent, user] = await Promise.all([
    xano.scholarship.getById(scholarshipId).catch(() => null),
    xano.parents.findByClerkId(userId).catch(() => null),
    currentUser().catch(() => null),
  ]);
  if (!scholarship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Primary family identity: Clerk `publicMetadata.registration_families_id`,
  // which is stamped server-side only (`/api/families` GET/POST) and is the
  // SAME source the parent flow uses to load the scholarship in the first
  // place. Without this check, an account whose family is pinned in metadata
  // but whose Xano parent linkage is incomplete (no `registration_parents`
  // row for its clerk id, or the parent missing from the family row — common
  // for admin-created families and test accounts) could VIEW the scholarship
  // but got a 403 on every save.
  const scholarshipFamilyId = toId(scholarship.registration_families_id);
  const metaFamilyId = toId(user?.publicMetadata?.registration_families_id);
  if (
    metaFamilyId != null &&
    scholarshipFamilyId != null &&
    metaFamilyId === scholarshipFamilyId
  ) {
    return null;
  }

  // Fallback: resolve family membership through the Xano parent row.
  if (!parent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const family = await xano.families.findByParentId(parent.id).catch(() => null);
  if (!family || toId(family.id) !== scholarshipFamilyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Coerce an id that may arrive as a number, numeric string, or an
 *  expanded Xano relation object (`{ id: 60, ... }`) to a number. */
function toId(v: unknown): number | null {
  if (typeof v === "object" && v !== null && "id" in v) {
    v = (v as { id: unknown }).id;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
