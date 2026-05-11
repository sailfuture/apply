import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoFamilyApplicationProgress } from "@/lib/xano";

/**
 * Admin GET — resolves the per-year progress row for a family. Mirrors
 * the `resolve` semantics so the caller always gets a row back (created
 * if missing). Useful so the Decision card on the family detail page
 * can render flipping `isAccepted` without first having to know whether
 * a row exists yet.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const familyId = Number(familyIdParam);
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const row = await xano.familyApplicationProgress.resolve(familyId, yearId);
    return NextResponse.json(row);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Admin-only PATCH for the per-year `registration_family_application_progress`
 * row. Used by the Decision card on the family detail page to flip
 * `isAccepted` (and its companions) without granting the parent-side
 * `/api/family-progress` route the same power — that one only allows the
 * authenticated parent to mutate progress on their own family, and
 * deliberately doesn't expose `isAccepted`.
 *
 * Resolves the row first so admins can accept a family that hasn't yet
 * touched the apply flow on their own (rare but possible — e.g. paper
 * applications transcribed by staff).
 *
 * Body: `{ familyId, yearId, isAccepted?, isSubmitted?, ... }`
 *
 * Only a small allowlist of fields is patchable; passing anything else
 * is silently ignored.
 */
/**
 * Section-confirm pairs — the bool is the canonical confirm flag
 * the UI reads/writes. The matching `*_admin_confirm_time`
 * timestamp + `*_admin_confirm_admin` admin-name string are auto-
 * stamped here so clients can't hand-write them.
 *
 * `completedKey` is the matching parent-side completion flag for
 * the section. When admin verifies (sets the confirm bool to
 * `true`), we also flip the parent-completion flag to `true` so
 * the parent's sidenav reflects "section done" without the parent
 * having to remember to click Complete. Admin verification is the
 * strongest signal — if admin says it's good, it's good.
 *
 * Testing has no `testing_admin_confirm_admin` column on Xano (the
 * schema only tracks the bool + time for that section), so its
 * `adminKey` is null and we skip the name stamp for it.
 */
const SECTION_CONFIRM_PAIRS: Array<{
  confirmKey: keyof XanoFamilyApplicationProgress;
  timeKey: keyof XanoFamilyApplicationProgress;
  adminKey: keyof XanoFamilyApplicationProgress | null;
  completedKey: keyof XanoFamilyApplicationProgress | null;
}> = [
  {
    confirmKey: "family_admin_confirm",
    timeKey: "family_admin_confirm_time",
    adminKey: "family_admin_confirm_admin",
    completedKey: "family_completed",
  },
  {
    confirmKey: "students_admin_confirm",
    timeKey: "students_admin_confirm_time",
    adminKey: "students_admin_confirm_admin",
    completedKey: "students_completed",
  },
  {
    confirmKey: "testing_admin_confirm",
    timeKey: "testing_admin_confirm_time",
    adminKey: null,
    completedKey: "testing_completed",
  },
  {
    // Financial Aid uses the same `*_admin_confirm` /
    // `*_admin_confirm_time` / `*_admin_confirm_admin` column
    // naming as Family / Students / Testing above. We briefly
    // wired this against `*_admin_complete` / `*_admin_time`
    // before the Xano schema was finalized; those columns don't
    // exist, so PATCHes were silently rejected. `completedKey:
    // null` because Financial Aid doesn't have a separate
    // parent-completion bool to cascade (parent saves as they
    // fill it out; admin verify is the only "this is good"
    // signal).
    confirmKey: "financial_aid_admin_confirm",
    timeKey: "financial_aid_admin_confirm_time",
    adminKey: "financial_aid_admin_confirm_admin",
    completedKey: null,
  },
  {
    // Scholarship Determination — admin verifies after every per-
    // student `confirmed_scholarship` is true. Note the
    // timestamp column is `scholarship_complete_admin_time`
    // (NOT `scholarship_admin_complete_time`) — the Xano schema
    // word order diverges from the bool's order. See the matching
    // note on `XanoFamilyApplicationProgress`. No parent-completion
    // column for this section either — the parent doesn't
    // participate in the scholarship determination; admin owns
    // the section end-to-end.
    confirmKey: "scholarship_admin_complete",
    timeKey: "scholarship_complete_admin_time",
    adminKey: "scholarship_admin_complete_admin",
    completedKey: null,
  },
];

export async function PATCH(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

    const familyId = Number(body?.familyId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Allowlist — admin can flip per-year decision flags + section
    // completion booleans (useful when correcting state), but not the
    // foreign keys or `id`. `last_edited` is bumped automatically.
    //
    // `is_archived` + `reason_for_archive` are scoped to the Archive
    // affordance in the family detail header. The reason field is
    // intentionally on the allowlist so the modal can pass the
    // captured rationale alongside the flag flip in one round
    // trip; the route doesn't enforce that reason is non-empty —
    // that's the UI's job (text required on the modal).
    //
    // Section-admin-confirm bools are on the allowlist; the matching
    // `*_admin_confirm_time` + `*_admin_confirm_admin` audit columns
    // are NOT allowed from the body — we stamp them here from the
    // admin's display name + Date.now() based on the bool's new
    // value. Mirrors the audit pattern in
    // `/api/admin/scholarships/[id]`.
    const ALLOWED: Array<keyof XanoFamilyApplicationProgress> = [
      "isAccepted",
      "isSubmitted",
      "submitted_at",
      "family_completed",
      "students_completed",
      "financial_aid_completed",
      "testing_completed",
      "registration_type_id",
      "is_archived",
      "reason_for_archive",
      "family_admin_confirm",
      "students_admin_confirm",
      "testing_admin_confirm",
      "financial_aid_admin_confirm",
      "scholarship_admin_complete",
    ];
    const patch: Record<string, unknown> = { last_edited: Date.now() };
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    // Resolve the row upfront so the auto-stamp logic below can
    // inspect the pre-patch state (e.g. preserve an existing
    // `submitted_at` rather than clobbering it with `now`). Cheaper
    // than fetching twice; the update at the end of the route reuses
    // this row's id.
    const row = await xano.familyApplicationProgress.resolve(familyId, yearId);

    // Acceptance implies submission. When admin accepts a family
    // (`isAccepted = true`), force `isSubmitted = true` and stamp
    // `submitted_at` if it isn't already set. Rationale: families
    // hand-accepted by admin (paper apps transcribed by staff, or
    // an admin-driven accept before the parent has hit the Submit
    // button themselves) used to land with `isSubmitted = false`
    // and disappear from the Submitted queue on the Applications
    // list. Flipping submission alongside acceptance keeps those
    // families visible in the queues they belong in. We only stamp
    // `submitted_at` when the row doesn't already carry one — a
    // real parent-submitted timestamp is preferred over the
    // admin-acceptance time.
    if (patch.isAccepted === true) {
      if (patch.isSubmitted === undefined) patch.isSubmitted = true;
      if (patch.submitted_at === undefined && !row.submitted_at) {
        patch.submitted_at = Date.now();
      }
    }

    // Auto-stamp the audit pair + cascade to parent-completion for
    // every section-confirm bool that appears in the patch.
    //
    // On verify (true):
    //   - time = now, admin = display name
    //   - matching `*_completed` flips to `true` so the parent's
    //     sidenav reflects "section done" — admin's verify is the
    //     strongest signal, overrides whatever in-progress edit
    //     state the parent was in
    //
    // On un-verify (false):
    //   - time = null, admin = ""
    //   - DO NOT touch `*_completed` — un-verifying is "I need to
    //     re-review", not "the parent has more work to do." If the
    //     parent had completed it previously, that stays. The
    //     existing parent-side cascade already clears the verify
    //     pair when the parent flips `*_completed=false`, so the
    //     two directions stay coherent.
    //
    // Testing has no admin column on Xano so its adminKey is null
    // and we skip that field; the bool + time + completion still
    // get written.
    const now = Date.now();
    const adminName = admin?.name ?? "";
    for (const pair of SECTION_CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        if (pair.adminKey) {
          patch[pair.adminKey] = next ? adminName : "";
        }
        if (next && pair.completedKey) {
          patch[pair.completedKey] = true;
        }
      }
    }

    if (Object.keys(patch).length <= 1) {
      // Only `last_edited` — nothing meaningful to update.
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.familyApplicationProgress.update(row.id, patch);

    // Cascade to the registration progress row when admin flips
    // acceptance. Two directions:
    //
    //   - `isAccepted = true` → resolve-or-create the
    //     `registration_student_registration_progress` row for
    //     this (family, year) and force `isSubmitted = true` so
    //     the family lands in the post-acceptance registration
    //     queue without waiting on the parent to click Submit
    //     again on the registration side. Stamps `submitted_date`
    //     only when the row doesn't already carry one — a real
    //     parent-side submission time wins.
    //
    //   - `isAccepted = false` (revoke) → clear
    //     `isRegistrationConfirmed` + the matching audit pair on
    //     the same row. Revoking an acceptance leaves a
    //     "confirmed registration for a no-longer-accepted family"
    //     state otherwise, which is incoherent and traps admin
    //     behind the unverify-locked gate (sections can't be
    //     undone while registration is confirmed). Unlocking the
    //     downstream rollup is the whole point of revoking.
    //
    // Best-effort: cascade failures don't fail the primary PATCH,
    // since the apply-flow row write already landed. Cascade
    // errors log + toast-fail the registration-side state but the
    // acceptance/revoke itself sticks.
    if ("isAccepted" in patch) {
      const accepting = patch.isAccepted === true;
      try {
        const regRow =
          await xano.studentRegistrationProgress.resolve(familyId, yearId);
        const regPatch: Record<string, unknown> = {
          last_edited: Date.now(),
        };
        if (accepting) {
          if (regRow.isSubmitted !== true) regPatch.isSubmitted = true;
          if (!regRow.submitted_date) regPatch.submitted_date = Date.now();
        } else {
          // Revoke path. Clear the family-level rollup latch + its
          // audit pair so admin can step into the registration
          // sections to amend them without the unverify-locked gate
          // blocking everything. Per-section verifies and per-
          // student packet `registrationConfirmed` flags stay
          // intact — those are admin's prior work, and re-accepting
          // shouldn't force admin to re-stamp every verify.
          if (regRow.isRegistrationConfirmed === true) {
            regPatch.isRegistrationConfirmed = false;
            regPatch.registration_confirmed_time = null;
            regPatch.registration_confirmed_admin = "";
          }
        }
        // Only write if the cascade actually wants to change something
        // (more than the auto-stamped `last_edited`). Idempotent —
        // re-accepting an already-submitted registration is a no-op.
        if (Object.keys(regPatch).length > 1) {
          await xano.studentRegistrationProgress.update(regRow.id, regPatch);
        }
      } catch (cascadeErr) {
        console.error(
          "[/api/admin/family-progress] registration-progress cascade failed:",
          cascadeErr
        );
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

// `adminTeacherIdAsNumber` was used to stamp the section-confirm
// audit teacher-id column, but the live Xano schema typed those
// columns as boolean so the int write 400'd. Helper removed for
// now; restore alongside re-enabling the audit-id stamp loop above
// if/when the column types are corrected.
