import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { removeStripeItemForApplication } from "@/lib/per-student-billing";
import { reconcileFamilySubscriptionItems } from "@/lib/billing";
import { sendBillingAlert } from "@/lib/billing-alerts";

/**
 * Move one student's registration paperwork to a different school
 * year.
 *
 *   POST /api/admin/students/[id]/paperwork-year
 *   body: { fromYearId: number, toYearId: number }
 *
 * "Paperwork" is everything filed per (student, year):
 *   - their `registration_application` row(s) — grade, SUFS,
 *     transportation, billing columns, enrollment agreement
 *   - their `registration_student_registration` packet — medical,
 *     sizing, placement, liability waiver
 * plus the student row's `registration_school_years_id` membership
 * array (fromYear swapped for toYear).
 *
 * This is DELIBERATELY separate from `enrollment_school_years_id`
 * (the School Account card's cohort year): that says which year the
 * student first came in with; this says which year a given cycle of
 * paperwork belongs to. When a student's enrollment year gets
 * corrected, the paperwork usually has to follow — otherwise the
 * Retention page (whose membership test is the application rows)
 * attributes their departure to the wrong year.
 *
 * Family-level rows (admissions progress, scholarship, family
 * payment) are NOT moved — a sibling may still legitimately belong
 * to the source year, and the resolvers create family rows for the
 * target year on demand.
 *
 * Billing: an active application can carry a live Stripe
 * SubscriptionItem keyed to the SOURCE year's family payment row.
 * That item is removed BEFORE the year is rewritten (blocking — a
 * failed removal aborts the whole move, same rule as the application
 * DELETE route), and a reconcile against the TARGET year runs after
 * the response so the student is re-added there if that year has
 * live billing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const studentId = Number(idParam);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const fromYearId = Number(body?.fromYearId);
    const toYearId = Number(body?.toYearId);
    if (
      !Number.isInteger(fromYearId) ||
      fromYearId <= 0 ||
      !Number.isInteger(toYearId) ||
      toYearId <= 0
    ) {
      return NextResponse.json(
        { error: "fromYearId and toYearId are required" },
        { status: 400 }
      );
    }
    if (fromYearId === toYearId) {
      return NextResponse.json(
        { error: "Pick a different year to move to." },
        { status: 400 }
      );
    }

    const [student, years, allApps, sourcePacket, targetPacket] =
      await Promise.all([
        xano.students.getById(studentId).catch(() => null),
        xano.schoolYears.getAll().catch(() => []),
        xano.applications.getAll(),
        xano.studentRegistration
          .getByStudentAndYear(studentId, fromYearId)
          .catch(() => null),
        xano.studentRegistration
          .getByStudentAndYear(studentId, toYearId)
          .catch(() => null),
      ]);
    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }
    const yearName = (id: number) =>
      years.find((y) => Number(y.id) === id)?.year_name || `year #${id}`;
    if (!years.some((y) => Number(y.id) === toYearId)) {
      return NextResponse.json(
        { error: "That school year doesn't exist." },
        { status: 400 }
      );
    }

    // Every application row this student filed under the source year
    // — recreated/deactivated duplicates included, so the whole cycle
    // moves as one and no stray row keeps them a "member" of the old
    // year on the Retention page.
    const sourceApps = allApps.filter(
      (a) =>
        Number(a.registration_students_id) === studentId &&
        Number(a.registration_school_years_id) === fromYearId
    );
    if (sourceApps.length === 0 && !sourcePacket) {
      return NextResponse.json(
        {
          error: `No registration paperwork found for ${yearName(fromYearId)}.`,
        },
        { status: 404 }
      );
    }

    // Collision guards — moving must never produce two competing
    // cycles for one (student, year). An ACTIVE application already in
    // the target year means the student genuinely has paperwork there;
    // two packets can't be merged automatically at all.
    const targetHasActiveApp = allApps.some(
      (a) =>
        Number(a.registration_students_id) === studentId &&
        Number(a.registration_school_years_id) === toYearId &&
        a.isActive !== false
    );
    if (targetHasActiveApp) {
      return NextResponse.json(
        {
          error: `This student already has an active application for ${yearName(toYearId)} — move or remove that one first.`,
        },
        { status: 409 }
      );
    }
    if (sourcePacket && targetPacket) {
      return NextResponse.json(
        {
          error: `This student already has a registration packet for ${yearName(toYearId)}, and two packets for one year can't be merged. Delete one of them first.`,
        },
        { status: 409 }
      );
    }

    // Live Stripe items come off FIRST, while the application still
    // points at the source year (the payment-row lookup inside needs
    // it). Throws on failure → abort with nothing changed, because a
    // moved row with a live item under the old year is silent
    // over-billing with no local handle left to find it by.
    const activeSourceApps = sourceApps.filter((a) => a.isActive !== false);
    for (const app of activeSourceApps) {
      try {
        await removeStripeItemForApplication(app);
      } catch (err) {
        console.error(
          `[/api/admin/students/${studentId}/paperwork-year] refusing move — Stripe item cleanup failed:`,
          err
        );
        return NextResponse.json(
          {
            error:
              "This student is on the family's live billing subscription and removing their Stripe line failed. Nothing was moved — try again, or remove the item in the Stripe Dashboard first.",
          },
          { status: 502 }
        );
      }
    }

    // The moves themselves. Sequential and reported honestly: if a
    // write fails midway the 502 says exactly what already moved so
    // admin can finish or revert by hand instead of guessing.
    const movedAppIds: number[] = [];
    let movedPacket = false;
    try {
      for (const app of sourceApps) {
        await xano.applications.update(app.id, {
          registration_school_years_id: toYearId,
        });
        movedAppIds.push(app.id);
      }
      if (sourcePacket) {
        await xano.studentRegistration.update(sourcePacket.id, {
          registration_school_years_id: toYearId,
        });
        movedPacket = true;
      }
    } catch (err) {
      console.error(
        `[/api/admin/students/${studentId}/paperwork-year] move failed partway:`,
        err
      );
      return NextResponse.json(
        {
          error: `The move failed partway through: ${movedAppIds.length} of ${sourceApps.length} application row(s)${movedPacket ? " and the packet" : ""} moved to ${yearName(toYearId)} before the error. Re-run the move to finish the rest.`,
        },
        { status: 502 }
      );
    }

    // Membership array on the student row: swap fromYear → toYear
    // (dedupe). Best-effort — the array is a convenience index (the
    // School Account card's default year), not the membership source
    // of truth, so a failed write shouldn't fail a move that already
    // landed.
    try {
      const current = Array.isArray(student.registration_school_years_id)
        ? student.registration_school_years_id.map(Number)
        : [];
      const next = [
        ...current.filter((y) => y !== fromYearId && y !== toYearId),
        toYearId,
      ];
      await xano.students.update(studentId, {
        registration_school_years_id: next,
      });
    } catch (err) {
      console.warn(
        `[/api/admin/students/${studentId}/paperwork-year] year-array update failed (move itself succeeded):`,
        err
      );
    }

    // Re-add the student to the TARGET year's billing if that year
    // has a live subscription. After the response (same shape as the
    // reactivate cascade), alert-on-failure so a hiccup can't become
    // a silently-unbilled student.
    const familyId =
      Number(activeSourceApps[0]?.registration_families_id) ||
      Number(student.registration_families_id) ||
      0;
    if (activeSourceApps.length > 0 && student.isArchived !== true && familyId) {
      after(async () => {
        try {
          await reconcileFamilySubscriptionItems(familyId, toYearId);
        } catch (err) {
          console.error(
            `[/api/admin/students/${studentId}/paperwork-year] reconcile after move failed:`,
            err
          );
          await sendBillingAlert(
            `Student NOT re-added to billing after paperwork-year move (family #${familyId})`,
            [
              `Student #${studentId}'s paperwork moved from ${yearName(fromYearId)} to ${yearName(toYearId)}, but the billing reconcile for the target year failed — the student may not be billed.`,
              `Open the family's admin billing card and click "Start Monthly Billing" to reconcile.`,
              `Error: ${err instanceof Error ? err.message : String(err)}`,
            ]
          );
        }
      });
    }

    return NextResponse.json({
      ok: true,
      movedApplications: movedAppIds.length,
      movedPacket,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
