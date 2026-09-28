import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getFamilyAuth } from "@/lib/family-auth";
import { xano } from "@/lib/xano";

/**
 * Ownership guards for the parent-facing Opportunity Scholarship routes
 * (`/api/scholarship*` and `/api/scholarship-items/*`).
 *
 * Those routes are shared by BOTH the parent apply flow (a parent
 * working on their own application) and the admin family-detail
 * cleanup, so a request is allowed when:
 *
 *   - the scholarship belongs to the caller's own family, OR
 *   - the caller is an admin (may touch any family's scholarship).
 *
 * Previously most of these routes only checked `auth()` (logged-in), so
 * any authenticated user could read, edit or delete another family's
 * financial records by iterating a numeric id (IDOR).
 *
 * Both guards return a `NextResponse` to return early (401 / 403 / 404)
 * when the request is NOT allowed, or `null` when it is.
 */

/**
 * Guard for routes keyed on a scholarship id (or on a child row whose
 * parent scholarship id the caller already resolved via the item's
 * `getById`).
 */
export async function denyScholarshipAccess(
  scholarshipId: number | null | undefined
): Promise<NextResponse | null> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const validId =
    typeof scholarshipId === "number" &&
    Number.isFinite(scholarshipId) &&
    scholarshipId > 0;
  const scholarship = validId
    ? await xano.scholarship.getById(scholarshipId).catch(() => null)
    : null;
  // An unresolvable scholarship has no family to match, so only an
  // admin gets past `denyScholarshipFamilyAccess`; everyone else sees a
  // 404 rather than learning whether the id exists.
  return denyScholarshipFamilyAccess(scholarshipFamilyId(scholarship));
}

/** The family a scholarship row belongs to, or null when it can't be
 *  resolved. Tolerates the FK arriving as an expanded relation object. */
export function scholarshipFamilyId(
  scholarship: { registration_families_id?: unknown } | null | undefined
): number | null {
  return toId(scholarship?.registration_families_id);
}

/**
 * Guard for routes keyed on a family id (`/api/scholarship` GET + POST),
 * and the shared tail of `denyScholarshipAccess` above.
 */
export async function denyScholarshipFamilyAccess(
  familyId: number | null | undefined
): Promise<NextResponse | null> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const targetFamilyId = toId(familyId);

  // Primary family identity: the session's family id — the token claim
  // when present, else Clerk `publicMetadata.registration_families_id`,
  // which is stamped server-side only (`/api/families` GET/POST) and is
  // the SAME source the parent flow uses to load the scholarship in the
  // first place. Checked first because it's the common case and the
  // cheapest: a parent on their own application costs no Xano lookup.
  // A Clerk hiccup here must not lock the parent out, so a failure
  // falls through to the Xano parent-row check below.
  const session = await getFamilyAuth().catch(() => null);
  if (targetFamilyId != null && session?.familyId === targetFamilyId) {
    return null;
  }

  // Admins may touch any family's scholarship.
  const admin = await getCurrentAdmin();
  if (admin) return null;

  if (targetFamilyId == null) {
    // No resolvable family — 404 rather than leaking whether the id
    // exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fallback: resolve family membership through the Xano parent row.
  // Covers an account whose family isn't pinned in Clerk metadata yet.
  // The reverse gap — family pinned in metadata but the Xano parent
  // linkage incomplete (no `registration_parents` row for its clerk id,
  // or the parent missing from the family row; common for admin-created
  // families and test accounts) — is what the session check above
  // exists for: without it those accounts could VIEW the scholarship
  // but got a 403 on every save.
  const parent = await xano.parents.findByClerkId(userId).catch(() => null);
  if (!parent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const family = await xano.families.findByParentId(parent.id).catch(() => null);
  if (!family || toId(family.id) !== targetFamilyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Copy only the allowlisted keys of a request body into a patch. The
 * parent routes pass the result to Xano instead of the raw body, so a
 * parent can't write admin-owned columns (document confirm flags, audit
 * stamps) or re-point a row at another family's scholarship.
 */
export function pickAllowedFields(
  body: unknown,
  allowlist: ReadonlyArray<string>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return patch;
  const source = body as Record<string, unknown>;
  for (const field of allowlist) {
    if (field in source) patch[field] = source[field];
  }
  return patch;
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
