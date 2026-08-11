import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin families list — single round trip via the Xano
 * `/registration_families_all_details` endpoint, projected into a
 * lightweight per-row shape for the table.
 *
 * Optional `?yearId=X` filters the application counts to one school year.
 * Without it, application counts span all years (useful for "who has any
 * application history" pivots).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = yearIdParam ? Number(yearIdParam) : null;

    // Students fetched alongside so rows can carry display names —
    // the all-details payload only has student FKs (the "students"
    // array is really application rows). Degrades to empty names on
    // a hiccup rather than failing the list.
    const [families, students] = await Promise.all([
      xano.families.getAllDetails(),
      xano.students.getAll().catch(() => []),
    ]);
    const studentNameById = new Map(
      students.map((s) => [
        s.id,
        `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
      ])
    );

    const rows = families.map((family) => {
      // Apps for the year (or all of them if no year filter). Each app
      // already has the four decision booleans so we can derive the
      // current status without a follow-up fetch.
      const yearApps = yearId
        ? family.registration_students_id.filter(
            (a) => Number(a.registration_school_years_id) === yearId
          )
        : family.registration_students_id;

      // Distinct student FKs — same student can appear across multiple
      // years, so dedupe before counting.
      const studentIds = new Set(
        family.registration_students_id
          .map((a) => Number(a.registration_students_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );

      return {
        id: family.id,
        family_name: family.family_name || `Family #${family.id}`,
        created_at: family.created_at,
        parent_count: family.registration_parents_id.length,
        student_count: studentIds.size,
        application_count: yearApps.length,
        // No status field: per-app decision flags never existed in
        // Xano, so the old `top_status` always computed "draft" — and
        // nothing consumed it. Family lifecycle comes from the
        // `family_application_progress` row where it's needed.
        primary_email: family.registration_parents_id[0]?.email ?? "",
        primary_name: family.registration_parents_id[0]
          ? `${family.registration_parents_id[0].first_name} ${family.registration_parents_id[0].last_name}`.trim()
          : "",
        // Every parent beyond the first — surfaces the secondary
        // contact in pickers/search (the New Message dialog). Joined
        // in case a family carries more than two parent records.
        secondary_name: family.registration_parents_id
          .slice(1)
          .map((p) => `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim())
          .filter(Boolean)
          .join(", "),
        // Distinct student display names for the same pickers —
        // admins often only know the student, not the parents.
        student_names: Array.from(studentIds)
          .map((id) => studentNameById.get(id) ?? "")
          .filter(Boolean)
          .join(", "),
      };
    });

    // Stable order — most recently created first so new families surface
    // at the top of the table.
    rows.sort((a, b) => b.created_at - a.created_at);

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}
