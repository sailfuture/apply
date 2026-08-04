import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoParent } from "@/lib/xano";

/**
 * Compact family profile — the Messages inbox's "Family details"
 * sheet. Deliberately light: name + parents + students, not the full
 * registration payload (the sheet links to `/admin/families/[id]` for
 * that).
 */
export interface FamilyProfileResponse {
  id: number;
  family_name: string;
  is_residential: boolean;
  parents: Array<{
    id: number;
    name: string;
    relationship: string;
    phone: string;
    email: string;
  }>;
  students: Array<{ id: number; name: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [family, students] = await Promise.all([
      xano.families.getById(id),
      xano.students.getByFamilyId(id).catch(() => []),
    ]);
    if (!family) {
      return NextResponse.json({ error: "Family not found" }, { status: 404 });
    }

    const parents = (
      await Promise.all(
        xano.families
          .getParentIds(family)
          .map((pid) => xano.parents.getById(pid).catch(() => null))
      )
    ).filter((p): p is XanoParent => p != null);

    const payload: FamilyProfileResponse = {
      id: family.id,
      family_name: family.family_name ?? "",
      is_residential: family.is_residential === true,
      parents: parents.map((p) => ({
        id: p.id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        relationship: p.relationship ?? "",
        phone: p.phone ?? "",
        email: p.email ?? "",
      })),
      students: students
        .filter((s) => !s.isArchived)
        .map((s) => ({
          id: s.id,
          name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
        })),
    };
    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}
