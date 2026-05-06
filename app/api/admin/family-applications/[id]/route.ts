import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin DELETE — wipe a single (family, year) application AND every
 * row that hangs off it.
 *
 * URL: `DELETE /api/admin/family-applications/[id]?yearId=X`
 *   `[id]` is the family id (matches the page URL pattern at
 *   `/admin/families/[id]`); `yearId` scopes which year's
 *   application to remove. Both required.
 *
 * What gets deleted (in dependency order so FKs don't trip up Xano):
 *
 *   1. Scholarship dependents — contributing members, homes,
 *      vehicles, benefits — for the family's per-year scholarship
 *      row.
 *   2. The scholarship row itself.
 *   3. Per-student `registration_application` rows for the year.
 *   4. Per-student `registration_student_registration` packets for
 *      the year — admin who's deleting an application is also
 *      starting the registration packet over if the family
 *      eventually re-applies.
 *   5. The family-level `registration_student_registration_progress`
 *      row for the year.
 *   6. The family-level `registration_families_payment` row for
 *      the year.
 *   7. The family-level `registration_family_application_progress`
 *      row for the year — last so the apply-side progress tracking
 *      survives until everything else is gone.
 *
 * What deliberately stays:
 *
 *   - The family + parent + student rows themselves. Those are
 *     evergreen across years; deleting them would orphan unrelated
 *     years' data and violate FK constraints. If admin wants to
 *     fully remove a family, do it at the family level instead.
 *   - Emergency contacts (family-evergreen).
 *   - Document arrays on the student row (birth cert, transcripts,
 *     etc.) — those follow the student across re-applications.
 *   - Admin notes — kept as an audit trail of what happened, even
 *     after the application is gone. Admin can manually clean up
 *     notes if they need to.
 *
 * Strategy:
 *   - Parallelize within a dependency level (`Promise.allSettled`)
 *     so one bad row doesn't block the rest of that level. We log
 *     individual failures + collect them into a `failures` array
 *     returned alongside the success response so the UI can warn
 *     the admin if something didn't fully clean up.
 *   - Sequence the levels (we await each level before starting the
 *     next) so children always go before parents.
 */
export async function DELETE(
  req: NextRequest,
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

    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const failures: Array<{ step: string; message: string }> = [];

    // ── Level 1: Scholarship + its dependents ──────────────────
    // Look up the scholarship row first; if none exists, we just
    // skip this whole level. Xano doesn't expose a cascade delete
    // so we have to walk the children explicitly.
    const scholarship = await xano.scholarship
      .getByFamilyAndYear(familyId, yearId)
      .catch((err: unknown) => {
        console.error(
          "[DELETE family-applications] scholarship lookup failed:",
          err
        );
        return null;
      });

    if (scholarship) {
      const [
        contribMembers,
        homes,
        vehicles,
        benefits,
      ] = await Promise.all([
        xano.scholarshipContributingMembers
          .getByScholarshipId(scholarship.id)
          .catch(() => []),
        xano.scholarshipHomes
          .getByScholarshipId(scholarship.id)
          .catch(() => []),
        xano.scholarshipVehicles
          .getByScholarshipId(scholarship.id)
          .catch(() => []),
        xano.scholarshipBenefits
          .getByScholarshipId(scholarship.id)
          .catch(() => []),
      ]);

      // Delete all scholarship-children in parallel — each row is
      // independent of the others at this level so order within the
      // level doesn't matter.
      const childResults = await Promise.allSettled([
        ...contribMembers.map((m) =>
          xano.scholarshipContributingMembers.delete(m.id)
        ),
        ...homes.map((h) => xano.scholarshipHomes.delete(h.id)),
        ...vehicles.map((v) => xano.scholarshipVehicles.delete(v.id)),
        ...benefits.map((b) => xano.scholarshipBenefits.delete(b.id)),
      ]);
      collectFailures(childResults, "scholarship-children", failures);

      // Now safe to delete the parent scholarship row.
      try {
        await xano.scholarship.delete(scholarship.id);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "scholarship delete failed";
        console.error(
          "[DELETE family-applications] scholarship delete failed:",
          err
        );
        failures.push({ step: "scholarship", message });
      }
    }

    // ── Level 2: Per-student rows scoped to this year ──────────
    // Applications + registration packets are both keyed on the
    // (student, year) pair. Pull them by family then filter to
    // the year so we only nuke this year's rows.
    const apps = await xano.applications
      .getByFamilyId(familyId)
      .catch(() => []);
    const yearApps = apps.filter(
      (a) => Number(a.registration_school_years_id) === yearId
    );

    const yearPackets = await xano.studentRegistration
      .getByYear(yearId)
      .catch(() => []);
    // Cross-reference packets-by-year against this family's students
    // (apps carry the student id) so we don't delete other families'
    // packets if Xano returns the full table.
    const familyStudentIds = new Set(
      yearApps.map((a) => Number(a.registration_students_id))
    );
    // Some families have multiple-year applications; the year filter
    // above + the family-student cross-check below scope us strictly
    // to (family, year).
    const familyYearPackets = yearPackets.filter((p) =>
      familyStudentIds.has(Number(p.registration_students_id))
    );

    const perStudentResults = await Promise.allSettled([
      ...yearApps.map((a) => xano.applications.delete(a.id)),
      ...familyYearPackets.map((p) => xano.studentRegistration.delete(p.id)),
    ]);
    collectFailures(perStudentResults, "per-student", failures);

    // ── Level 3: Family-level per-year rows ────────────────────
    // Each of these is one row per (family, year). Parallelizable
    // because they don't reference each other.
    const [regProgress, payment] = await Promise.all([
      xano.studentRegistrationProgress
        .getByFamilyAndYear(familyId, yearId)
        .catch(() => null),
      xano.familyPayments
        .getByFamilyAndYear(familyId, yearId)
        .catch(() => null),
    ]);

    const familyYearResults = await Promise.allSettled([
      ...(regProgress
        ? [xano.studentRegistrationProgress.delete(regProgress.id)]
        : []),
      ...(payment ? [xano.familyPayments.delete(payment.id)] : []),
    ]);
    collectFailures(familyYearResults, "family-year", failures);

    // ── Level 4: Family-application progress (last) ────────────
    // The apply-side progress row is the entry-point that everything
    // else hangs off of, so we delete it last. A row may not exist
    // (paper applications transcribed by staff sometimes skip the
    // progress flow) so the lookup is best-effort.
    const familyAppProgress = await xano.familyApplicationProgress
      .getByFamilyAndYear(familyId, yearId)
      .catch(() => null);
    if (familyAppProgress) {
      try {
        await xano.familyApplicationProgress.delete(familyAppProgress.id);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "family-application progress delete failed";
        console.error(
          "[DELETE family-applications] family-application progress delete failed:",
          err
        );
        failures.push({ step: "family-application-progress", message });
      }
    }

    return NextResponse.json({
      ok: true,
      familyId,
      yearId,
      // Surface partial-failure info so the UI can warn the admin
      // when the cascade didn't fully clean up. Empty array means a
      // clean delete.
      failures,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Walk the results from a `Promise.allSettled` batch and push any
 * rejections into the cumulative `failures` array. Each failure
 * carries the rejection message so the response payload can tell
 * admin which step left a row behind.
 */
function collectFailures(
  results: PromiseSettledResult<unknown>[],
  step: string,
  failures: Array<{ step: string; message: string }>
): void {
  for (const result of results) {
    if (result.status === "rejected") {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`[DELETE family-applications] ${step} failed:`, message);
      failures.push({ step, message });
    }
  }
}
