import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Applications list — one row per family per year, backed by the
 * Xano `registration_family_application_progress_by_year` query. Each
 * row carries the four section-completion booleans (`family_completed`,
 * `students_completed`, `financial_aid_completed`, `testing_completed`)
 * plus the hard-submit flag, so the admin table can show a progress
 * indicator at a glance.
 *
 * To make the row labels human-readable we merge in family + primary
 * parent details from the existing enriched families endpoint
 * (`registration_families_all_details`). Two parallel reads here, joined
 * client-side. Once Xano exposes those fields directly on the progress
 * endpoint we can drop the join.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    if (!yearIdParam) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    // Fetch both side-by-side, but isolate failures: if the families
    // join fails (Xano hiccup, schema drift, etc.) we can still render
    // the table with the progress rows and fall back to "Family #X"
    // labels — much better than 500ing the whole admin page. Each
    // failure logs the underlying error so the server console tells us
    // exactly what went wrong.
    const [progressResult, familiesResult] = await Promise.allSettled([
      xano.familyApplicationProgress.getByYear(yearId),
      xano.families.getAllDetails(),
    ]);

    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load family progress:",
        progressResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load families join:",
        familiesResult.reason
      );
    }

    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));

    const rows: AppProgressRow[] = progressRows.map((p) => {
      const family = familyById.get(p.registration_families_id) ?? null;
      const primary = family?.registration_parents_id?.[0] ?? null;
      const sectionsComplete = [
        p.family_completed,
        p.students_completed,
        p.financial_aid_completed,
        p.testing_completed,
      ].filter(Boolean).length;
      return {
        id: p.id,
        family_id: p.registration_families_id,
        year_id: p.registration_school_years_id,
        family_name:
          family?.family_name || `Family #${p.registration_families_id}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: family
          ? new Set(
              family.registration_students_id
                .map((a) => Number(a.registration_students_id))
                .filter((id) => Number.isFinite(id) && id > 0)
            ).size
          : 0,
        family_completed: !!p.family_completed,
        students_completed: !!p.students_completed,
        financial_aid_completed: !!p.financial_aid_completed,
        testing_completed: !!p.testing_completed,
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        submitted_at: p.submitted_at,
        last_edited: p.last_edited,
      };
    });

    // Submitted apps first (admin reviews those), then in-progress by
    // last_edited recency, then unstarted at the bottom.
    rows.sort((a, b) => {
      if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? -1 : 1;
      const aEdit = a.last_edited ?? a.submitted_at ?? 0;
      const bEdit = b.last_edited ?? b.submitted_at ?? 0;
      return bEdit - aEdit;
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface AppProgressRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  family_completed: boolean;
  students_completed: boolean;
  financial_aid_completed: boolean;
  testing_completed: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
}
