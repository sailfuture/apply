import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { deriveApplicationStatus } from "@/lib/application-status";

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

    const families = await xano.families.getAllDetails();

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

      // Worst-case status across the family's apps for the selected year.
      // Used so admins scanning the families table can see "this family
      // has at least one submitted-but-undecided app to review."
      const statuses = yearApps.map((a) => deriveApplicationStatus(a));
      const priority = ["submitted", "offered", "accepted", "enrolled", "draft", "denied"];
      const topStatus =
        priority.find((s) => statuses.includes(s as ReturnType<typeof deriveApplicationStatus>)) ??
        null;

      return {
        id: family.id,
        family_name: family.family_name || `Family #${family.id}`,
        created_at: family.created_at,
        parent_count: family.registration_parents_id.length,
        student_count: studentIds.size,
        application_count: yearApps.length,
        isSubmitted: family.isSubmitted,
        isAccepted: family.isAccepted,
        top_status: topStatus,
        primary_email: family.registration_parents_id[0]?.email ?? "",
        primary_name: family.registration_parents_id[0]
          ? `${family.registration_parents_id[0].first_name} ${family.registration_parents_id[0].last_name}`.trim()
          : "",
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
