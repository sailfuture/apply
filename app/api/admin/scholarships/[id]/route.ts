import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarship } from "@/lib/xano";

/**
 * Admin-only PATCH for the per-year `registration_opportunity_scholarship`
 * row. Tightly scoped to the document-confirmation columns the admin
 * Scholarship Determination card writes — admin doesn't edit the
 * parent's submitted financial data through this surface; that
 * happens via the parent flow only.
 *
 * Writable columns (the booleans):
 *   - `is_snap_confirmed` — admin reviewed the SNAP award letter.
 *     Audit columns `snap_confirm_time` + `snap_confirm_admin` are
 *     auto-stamped here.
 *   - `is_unemployment_confirm` — admin reviewed the unemployment /
 *     termination letter (the no-contributing-member path).
 *     Audit columns `unemployment_confirm_time` +
 *     `unemployment_confirm_admin` are auto-stamped here.
 *
 * Audit pairing matches the contributing-members + benefits routes:
 * confirming stamps `Date.now()` + the admin's teacher id;
 * un-confirming clears them back to null / 0. Clients shouldn't
 * (and can't) hand-write the timestamp / admin columns.
 */

const CONFIRM_PAIRS = [
  {
    confirmKey: "is_snap_confirmed",
    timeKey: "snap_confirm_time",
    adminKey: "snap_confirm_admin",
    // Legacy column — `*_admin` typed as int (teacher id). Newer
    // confirm triples (see `tax_document_confirm` below) use a text
    // column carrying the admin's display name.
    adminType: "id" as const,
  },
  {
    confirmKey: "is_unemployment_confirm",
    timeKey: "unemployment_confirm_time",
    adminKey: "unemployment_confirm_admin",
    adminType: "id" as const,
  },
  {
    confirmKey: "tax_document_confirm",
    timeKey: "tax_document_confirm_time",
    adminKey: "tax_document_confirm_admin",
    // Newer convention — stamps the admin's display name as text so
    // the family-page Documents table can render "Confirmed by Hunter"
    // without a teacher-id → name lookup. Matches the contributing-
    // members + benefits routes.
    adminType: "name" as const,
  },
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();

    const allowed: Array<keyof XanoScholarship> = [
      "is_snap_confirmed",
      "is_unemployment_confirm",
      // Tax-return confirm flag — same shape as the SNAP / unemployment
      // flags above; required on the Opportunity Scholarship path so
      // admin can verify the prior-year 1040 + schedules. The audit
      // pair (`tax_document_confirm_time` + `tax_document_confirm_admin`)
      // is auto-stamped below alongside the boolean flip.
      "tax_document_confirm",
      // Scholarship path flags — admin can flip the family between
      // the three lifecycle states (full Opportunity Scholarship
      // application, SNAP pre-qualification, opted out) on behalf
      // of the parent. The three flags are mutually exclusive in
      // practice; the path-selector cascade below normalizes that
      // when admin sets any of them.
      "isOpportunityScholarship",
      "isSNAPBenefits",
      "isNotParticipating",
      // Document slots — admin can upload paperwork on behalf of the
      // family (SNAP award letter, unemployment / termination
      // letter, prior-year tax return). The columns hold Xano file
      // metadata arrays; the upload route returns the file metadata
      // which the client splices into the existing array before
      // PATCHing.
      "snap_benefits",
      "unemployment_letter",
      "tax_return",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key as string] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No allowed fields in body" },
        { status: 400 }
      );
    }

    // Path-flag mutual-exclusion cascade. When admin flips one of
    // the three path flags to `true`, clear the other two in the
    // same patch so the row can never carry conflicting signals
    // (e.g. both `isSNAPBenefits` and `isOpportunityScholarship`
    // true at once). Flipping a flag back to `false` doesn't
    // cascade — leaves the other two as-is so admin can
    // explicitly clear the path.
    const PATH_KEYS = [
      "isOpportunityScholarship",
      "isSNAPBenefits",
      "isNotParticipating",
    ] as const;
    for (const key of PATH_KEYS) {
      if (patch[key] === true) {
        for (const other of PATH_KEYS) {
          if (other !== key) patch[other] = false;
        }
        break;
      }
    }

    const adminTeacherId = adminTeacherIdAsNumber(admin.teacherId);
    const adminDisplayName = admin.name?.trim() || admin.email || "an admin";
    const now = Date.now();
    for (const pair of CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        // Legacy int columns stamp the teacher id; newer text columns
        // (tax_document_confirm_admin) stamp the admin's display name
        // so the family-page Documents table can render
        // "Confirmed by Hunter" without a teacher-id → name lookup.
        if (pair.adminType === "name") {
          patch[pair.adminKey] = next ? adminDisplayName : "";
        } else {
          patch[pair.adminKey] = next ? adminTeacherId : 0;
        }
      }
    }

    const updated = await xano.scholarship.update(id, patch);

    // SNAP-confirm cascade — backup safeguard. Once admin confirms
    // SNAP benefits, the Opportunity Scholarship auto-rebates
    // tuition beyond SUFS so the family owes only the annual fee
    // per student. We re-derive each active packet's billing
    // columns with `opportunityScholarshipRemaining: 0` so the
    // family-pays-tuition portion collapses to zero and the
    // monthly amount drops to `annual_fee / 12`. SUFS amounts are
    // preserved on the packet — SUFS applies independently of OS
    // coverage.
    //
    // Stripe is re-synced when each packet has a live
    // SubscriptionItem so the next invoice bills the new amount.
    //
    // Best-effort: failures here are logged but don't roll back the
    // confirmation itself — the scholarship row's `is_snap_confirmed`
    // flip is the source of truth, and the cascade can be retried by
    // un-confirming + re-confirming if it fails.
    if (
      "is_snap_confirmed" in patch &&
      patch.is_snap_confirmed === true
    ) {
      try {
        const familyId = updated.registration_families_id;
        const yearId = updated.registration_school_years_id;
        const [apps, yearPackets, schoolYear, {
          derivePacketBillingValues,
          syncStripeForPacket,
        }] = await Promise.all([
          xano.applications.getByFamilyId(familyId),
          xano.studentRegistration.getByYear(yearId),
          xano.schoolYears.getById(yearId).catch(() => null),
          import("@/lib/per-student-billing"),
        ]);
        const activeStudentIds = new Set(
          apps
            .filter(
              (a) =>
                Number(a.registration_school_years_id) === yearId &&
                (a as { isActive?: boolean }).isActive !== false
            )
            .map((a) => Number(a.registration_students_id))
        );
        const activePackets = yearPackets.filter((p) =>
          activeStudentIds.has(Number(p.registration_students_id))
        );
        await Promise.allSettled(
          activePackets.map(async (packet) => {
            // Preserve the packet's SUFS amount (SUFS award still
            // applies); collapse the family-pays-tuition portion to
            // 0 so OS coverage absorbs everything beyond SUFS.
            // `annualFee: null` lets the deriver fall through to the
            // school year's `annual_fees` policy.
            const derived = derivePacketBillingValues({
              schoolYearTuition: schoolYear?.tuition ?? 0,
              schoolYearAnnualFees: schoolYear?.annual_fees ?? null,
              sufsAwardAmount: packet.sufs_amount ?? 0,
              opportunityScholarshipRemaining: 0,
              annualFee: null,
            });
            const updatedPacket = await xano.studentRegistration.update(
              packet.id,
              derived
            );
            try {
              await syncStripeForPacket(updatedPacket);
            } catch (err) {
              console.error(
                "[/api/admin/scholarships/[id]] Stripe sync failed for packet",
                packet.id,
                err
              );
            }
          })
        );
      } catch (err) {
        console.error(
          "[/api/admin/scholarships/[id]] SNAP cascade failed:",
          err
        );
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Same coercion the contributing-members + benefits routes use —
 *  keeps audit-id semantics consistent across every confirmation
 *  surface that stamps `*_confirm_admin`. */
function adminTeacherIdAsNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
