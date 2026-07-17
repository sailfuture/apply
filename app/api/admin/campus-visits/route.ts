import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoSchoolYear } from "@/lib/xano";

/**
 * Campus-visit liability waivers (signed on the marketing site) for
 * the admin Campus Visits page.
 *
 * The `website_liability_waiver` table has no school-year column, so
 * the academic year is DERIVED here from the signing date: a waiver
 * falls into the school year whose [start_date, end_date] window
 * contains it; dates in the gap between years (summer) roll forward
 * into the year that starts next. When no `registration_school_years`
 * row brackets the date at all, fall back to the Aug-1 convention
 * ("2026-2027" = Aug 1 2026 → Jul 31 2027) so every row always has a
 * year label to sort/filter on.
 */
export const dynamic = "force-dynamic";

// A `type` (not `interface`) so it satisfies DataTable's
// `Record<string, unknown>` constraint — type aliases get an implicit
// index signature, interfaces don't.
export type CampusVisitRow = {
  id: number;
  signed_ts: number;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  student_name: string;
  student_grade: string;
  student_school: string;
  marketing_opt_in: boolean;
  academic_year: string;
  /** Absolute URL of the signature image, when one was captured. */
  signature_url: string | null;
};

function deriveAcademicYear(ts: number, years: XanoSchoolYear[]): string {
  // Windows sorted by start so the roll-forward pick is deterministic.
  const windows = years
    .filter((y) => y.start_date && y.year_name)
    .map((y) => ({
      name: y.year_name,
      start: Date.parse(`${y.start_date}T00:00:00Z`),
      end: y.end_date
        ? Date.parse(`${y.end_date}T23:59:59Z`)
        : Number.POSITIVE_INFINITY,
    }))
    .filter((w) => Number.isFinite(w.start))
    .sort((a, b) => a.start - b.start);

  const within = windows.find((w) => ts >= w.start && ts <= w.end);
  if (within) return within.name;
  // Summer gap: a visit signed between years belongs to the UPCOMING
  // year (families tour before enrolling).
  const upcoming = windows.find((w) => ts < w.start);
  if (upcoming) return upcoming.name;

  // No school-year rows bracket this date — Aug-1 convention.
  const d = new Date(ts);
  const y = d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${y + 1}`;
}

export async function GET() {
  try {
    await requireAdmin();
    const [waivers, years] = await Promise.all([
      xano.websiteWaivers.getAll(),
      xano.schoolYears.getAll().catch(() => [] as XanoSchoolYear[]),
    ]);

    const xanoHost = (process.env.XANO_API_BASE_URL ?? "").replace(
      /\/api:[^/]+\/?$/,
      ""
    );

    const rows: CampusVisitRow[] = waivers
      .map((w) => {
        // Authoritative timestamp: the signature moment, else the
        // signer-picked date (noon UTC so timezones can't shift the
        // day), else row creation.
        const signedTs =
          w.signed_at ??
          (w.signed_date
            ? Date.parse(`${w.signed_date}T12:00:00Z`)
            : w.created_at);
        const sig = w.signature_image;
        const signatureUrl =
          sig?.url ??
          (sig?.path && xanoHost ? `${xanoHost}${sig.path}` : null);
        return {
          id: w.id,
          signed_ts: signedTs,
          parent_name: w.parent_name ?? "",
          parent_email: w.parent_email ?? "",
          parent_phone: w.parent_phone ?? "",
          student_name: w.student_name ?? "",
          student_grade: w.student_grade ?? "",
          student_school: w.student_school ?? "",
          marketing_opt_in: w.marketing_opt_in === true,
          academic_year: deriveAcademicYear(signedTs, years),
          signature_url: signatureUrl,
        };
      })
      .sort((a, b) => b.signed_ts - a.signed_ts);

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}
