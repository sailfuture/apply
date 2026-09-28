import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { buildYearFamilies } from "@/lib/year-families";
import { xano } from "@/lib/xano";

/** A family admin can add to an event's RSVPs. */
export interface EventFamilyOption {
  id: number;
  name: string;
  /** Parent full names, so staff who know a parent find the family. */
  parents: string[];
  /** Student full names for the year, " · "-joined. */
  students: string;
}

export interface EventFamiliesResponse {
  families: EventFamilyOption[];
}

/**
 * The enrolled families for one year, for the Events sheet's "Add
 * RSVP" picker:
 *
 *   GET /api/admin/events/families?yearId=Y → { families }
 *
 * Separate from `/api/admin/events` so the page itself doesn't pay for
 * the application and student tables on every load — the picker asks
 * for this only when it opens. Enrolled families only, matching the
 * volunteer-hours pickers and the parents who can see events at all.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [families, parents, fap, srp, applications, students] =
      await Promise.all([
        xano.families.getAll(),
        xano.parents.getAll(),
        xano.familyApplicationProgress.getByYear(yearId),
        xano.studentRegistrationProgress.getByYear(yearId),
        xano.applications.getAll(),
        xano.students.getAll(),
      ]);

    const parentName = new Map(
      parents.map((p) => [
        p.id,
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      ])
    );
    const familyById = new Map(families.map((f) => [f.id, f]));

    const options: EventFamilyOption[] = buildYearFamilies({
      yearId,
      families,
      fap,
      srp,
      applications,
      students,
    })
      .filter((f) => f.enrolled)
      .map((f) => {
        const family = familyById.get(f.id);
        return {
          id: f.id,
          name: f.name,
          parents: family
            ? xano.families
                .getParentIds(family)
                .map((id) => parentName.get(id) ?? "")
                .filter(Boolean)
            : [],
          students: f.students,
        };
      });

    return NextResponse.json({
      families: options,
    } satisfies EventFamiliesResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}
