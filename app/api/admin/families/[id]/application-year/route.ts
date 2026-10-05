import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";

/**
 * Move an applying or registering family's paperwork to a different
 * school year.
 *
 *   POST /api/admin/families/[id]/application-year
 *   body: { fromYearId: number, toYearId: number }
 *
 * For families who applied under the wrong year (e.g. filed for next
 * year when they're starting this year). Moves everything the apply
 * flow files per (family, year):
 *   - every `registration_application` row on the source year
 *   - the family's `family_application_progress` row (submitted /
 *     step flags), so the family doesn't read as un-submitted in the
 *     target year's pipeline
 *   - the family's scholarship row
 *   - each student's `registration_school_years_id` membership array
 * and, for a family that's accepted and registering:
 *   - each student's registration packet
 *   - the family's registration progress row
 *   - the family's payment setup row
 *
 * Starting terms are cleared on the moved applications — terms belong
 * to a school year, so the old pick can't carry over.
 *
 * Not for enrolled families (registration confirmed) or any family
 * whose billing has started — a live Stripe subscription or recorded
 * payments for the year. Money records don't get re-filed
 * automatically; enrolled students move one at a time through
 * /api/admin/students/[id]/paperwork-year, which keeps Stripe in step.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json({ error: "Invalid family id" }, { status: 400 });
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

    const [
      years,
      apps,
      sourceProgressAll,
      targetProgressAll,
      scholarships,
      sourceRegProgressAll,
      targetRegProgressAll,
      sourcePayment,
      targetPayment,
      sourceTransactions,
    ] = await Promise.all([
      xano.schoolYears.getAll().catch(() => []),
      xano.applications.getByFamilyId(familyId),
      xano.familyApplicationProgress.getByYear(fromYearId),
      xano.familyApplicationProgress.getByYear(toYearId),
      xano.scholarship.getAll().catch(() => []),
      xano.studentRegistrationProgress.getByYear(fromYearId),
      xano.studentRegistrationProgress.getByYear(toYearId),
      xano.familyPayments.getByFamilyAndYearStrict(familyId, fromYearId),
      xano.familyPayments.getByFamilyAndYearStrict(familyId, toYearId),
      xano.paymentTransactions.getByFamilyAndYear(familyId, fromYearId),
    ]);
    const yearName = (id: number) =>
      years.find((y) => Number(y.id) === id)?.year_name || `year #${id}`;
    if (!years.some((y) => Number(y.id) === toYearId)) {
      return NextResponse.json(
        { error: "That school year doesn't exist." },
        { status: 400 }
      );
    }

    const forFamily = <T extends { registration_families_id: number }>(
      rows: T[]
    ) => rows.filter((r) => Number(r.registration_families_id) === familyId);
    const sourceProgress = forFamily(sourceProgressAll).filter(
      (p) => p.is_archived !== true
    );
    const targetProgress = forFamily(targetProgressAll).filter(
      (p) => p.is_archived !== true
    );
    const sourceApps = apps.filter(
      (a) => Number(a.registration_school_years_id) === fromYearId
    );
    const targetApps = apps.filter(
      (a) =>
        Number(a.registration_school_years_id) === toYearId &&
        a.isActive !== false
    );
    const scholarshipOf = (yearId: number) =>
      forFamily(scholarships).filter(
        (s) => Number(s.registration_school_years_id) === yearId
      );
    const sourceScholarships = scholarshipOf(fromYearId);
    const targetScholarships = scholarshipOf(toYearId);

    if (sourceApps.length === 0 && sourceProgress.length === 0) {
      return NextResponse.json(
        { error: `This family has no application for ${yearName(fromYearId)}.` },
        { status: 404 }
      );
    }
    const sourceRegProgress = forFamily(sourceRegProgressAll).filter(
      (r) => r.isArchived !== true
    );
    const targetRegProgress = forFamily(targetRegProgressAll).filter(
      (r) => r.isArchived !== true
    );
    if (sourceRegProgress.some((r) => r.isRegistrationConfirmed === true)) {
      return NextResponse.json(
        {
          error:
            "This family is already enrolled. Move each student from their Enrolled page instead, so billing moves with them.",
        },
        { status: 409 }
      );
    }
    if (
      activeStripeSubscriptionId(sourcePayment?.stripe_subscription_id) ||
      sourceTransactions.length > 0
    ) {
      return NextResponse.json(
        {
          error: `Billing has already started for this family in ${yearName(fromYearId)} (a live subscription or recorded payments), so their records can't be moved automatically. Sort out billing first, then move them.`,
        },
        { status: 409 }
      );
    }

    // Registration packets for the students being moved — a
    // registering family has one per student.
    const studentIds = [
      ...new Set(sourceApps.map((a) => Number(a.registration_students_id))),
    ].filter((id) => id > 0);
    const packetPairs = await Promise.all(
      studentIds.map(async (sid) => ({
        source: await xano.studentRegistration
          .getByStudentAndYear(sid, fromYearId)
          .catch(() => null),
        target: await xano.studentRegistration
          .getByStudentAndYear(sid, toYearId)
          .catch(() => null),
      }))
    );
    const sourcePackets = packetPairs.flatMap((p) => (p.source ? [p.source] : []));

    // Collision guards — never leave two competing applications for
    // one year. An empty, unsubmitted target progress row (the family
    // clicked into that year and left) is fine to retire; anything
    // with real work in it needs a person to decide.
    if (targetApps.length > 0) {
      return NextResponse.json(
        {
          error: `This family already has an application for ${yearName(toYearId)}. Remove it first, or keep that one and remove this one.`,
        },
        { status: 409 }
      );
    }
    if (targetProgress.some((p) => p.isSubmitted === true)) {
      return NextResponse.json(
        {
          error: `This family already submitted an application for ${yearName(toYearId)}.`,
        },
        { status: 409 }
      );
    }
    if (packetPairs.some((p) => p.source && p.target)) {
      return NextResponse.json(
        {
          error: `A student in this family already has a registration packet for ${yearName(toYearId)}, and two packets for one year can't be merged. Delete one first.`,
        },
        { status: 409 }
      );
    }
    if (sourceRegProgress.length > 0 && targetRegProgress.length > 0) {
      return NextResponse.json(
        {
          error: `This family already has registration progress for ${yearName(toYearId)}. Archive it first.`,
        },
        { status: 409 }
      );
    }
    if (sourcePayment && targetPayment) {
      return NextResponse.json(
        {
          error: `This family already has a payment setup for ${yearName(toYearId)}, and the two can't be merged. Remove one first.`,
        },
        { status: 409 }
      );
    }
    if (sourceScholarships.length > 0 && targetScholarships.length > 0) {
      return NextResponse.json(
        {
          error: `This family has a scholarship application on both years, and the two can't be merged. Delete the ${yearName(toYearId)} one first.`,
        },
        { status: 409 }
      );
    }

    // Sequential and reported honestly: a failure midway says exactly
    // what already moved. A re-run would trip the collision guards on
    // the rows that made it across, so the rest is finished by hand.
    const moved: string[] = [];
    try {
      for (const p of targetProgress) {
        await xano.familyApplicationProgress.update(p.id, {
          is_archived: true,
        });
      }
      for (const app of sourceApps) {
        await xano.applications.update(app.id, {
          registration_school_years_id: toYearId,
          registration_academic_terms_id: 0,
        });
      }
      if (sourceApps.length) moved.push(`${sourceApps.length} application(s)`);
      for (const p of sourceProgress) {
        await xano.familyApplicationProgress.update(p.id, {
          registration_school_years_id: toYearId,
          last_edited: Date.now(),
        });
      }
      if (sourceProgress.length) moved.push("application progress");
      for (const s of sourceScholarships) {
        await xano.scholarship.update(s.id, {
          registration_school_years_id: toYearId,
        });
      }
      if (sourceScholarships.length) moved.push("scholarship application");
      for (const packet of sourcePackets) {
        await xano.studentRegistration.update(packet.id, {
          registration_school_years_id: toYearId,
        });
      }
      if (sourcePackets.length) moved.push(`${sourcePackets.length} registration packet(s)`);
      for (const r of sourceRegProgress) {
        await xano.studentRegistrationProgress.update(r.id, {
          registration_school_years_id: toYearId,
        });
      }
      if (sourceRegProgress.length) moved.push("registration progress");
      if (sourcePayment) {
        await xano.familyPayments.update(sourcePayment.id, {
          registration_school_years_id: toYearId,
        });
        moved.push("payment setup");
      }
    } catch (err) {
      console.error(
        `[/api/admin/families/${familyId}/application-year] move failed partway:`,
        err
      );
      return NextResponse.json(
        {
          error: `The move failed partway through${moved.length ? ` (already moved: ${moved.join(", ")})` : ""}. The rest is still on ${yearName(fromYearId)} and needs moving by hand — note this message before closing it.`,
        },
        { status: 502 }
      );
    }

    // Student membership arrays — a convenience index, not the source
    // of truth, so a failed write logs instead of failing the move.
    await Promise.all(
      studentIds.map(async (sid) => {
        try {
          const student = await xano.students.getById(sid);
          const current = Array.isArray(student.registration_school_years_id)
            ? student.registration_school_years_id.map(Number)
            : [];
          await xano.students.update(sid, {
            registration_school_years_id: [
              ...current.filter((y) => y !== fromYearId && y !== toYearId),
              toYearId,
            ],
          });
        } catch (err) {
          console.warn(
            `[/api/admin/families/${familyId}/application-year] year-array update failed for student ${sid} (move itself succeeded):`,
            err
          );
        }
      })
    );

    return NextResponse.json({
      ok: true,
      movedApplications: sourceApps.length,
      movedProgress: sourceProgress.length,
      movedScholarships: sourceScholarships.length,
      movedPackets: sourcePackets.length,
      movedRegistrationProgress: sourceRegProgress.length,
      movedPayment: sourcePayment ? 1 : 0,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
