import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudent } from "@/lib/xano";

/**
 * Admin-only PATCH for `registration_students`.
 *
 * Today this surface owns one admin-side write path:
 *
 *   - Initial-screening NWEA scores + dates — entered after the
 *     student completes testing at the academy. Live on the
 *     student row (not the per-year application) so re-enrolling
 *     students keep their score history.
 *
 * The `is_verified` flag on the student row was briefly written by
 * this route too, but admin verification was moved back to the
 * per-packet `registrationConfirmed` flag (with audit pair
 * `registration_confirmed_admin_time` /
 * `regisration_admin_confirmed_admin` — typo intentional, matches
 * Xano). Use `/api/admin/student-registration/[id]` for the verify
 * toggle now; that route auto-stamps the packet's audit pair.
 *
 * Parents never write to these columns; their /api/students/[id]
 * route excludes the admin-only fields from its allowlist.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Admin-only allowlist — we deliberately don't accept the
    // student bio fields (first_name, dob, etc.) here; those belong
    // on the parent flow's `/api/students/[id]`. Editing bio data
    // through admin is a separate workflow and would need its own
    // route.
    const ALLOWED: Array<keyof XanoStudent> = [
      "initial_screening_nwea_math",
      "initial_screening_nwea_reading",
      "initial_screening_nwea_math_date",
      "initial_screening_nwea_reading_date",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.students.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}
