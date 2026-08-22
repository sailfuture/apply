import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudentRegistration } from "@/lib/xano";

/**
 * Admin-only PATCH for one `registration_student_registration` packet.
 *
 * Distinct from the parent-side `/api/student-registration/[id]`
 * route: that one requires a parent Clerk session and is scoped to
 * the parent's own family — it can't flip the admin-only
 * `registrationConfirmed` flag (the parent dashboard reads this to
 * decide whether to render the enrolled view, so letting parents
 * flip it themselves would be a self-serve enrollment loophole).
 *
 * The admin route's primary use case is toggling
 * `registrationConfirmed` from the family registration detail page,
 * but the allowlist also covers the liability-waiver metadata so
 * an admin can mirror PandaDoc state back onto the row when
 * something goes sideways with the webhook.
 *
 * URL: `/api/admin/student-registration/[id]` where `[id]` is the
 *   packet's primary key.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid packet id" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Allowlist — admin can:
    //   - Flip the confirm flag (auto-stamps audit pair below)
    //   - Mirror PandaDoc state onto the liability-waiver columns
    //     when the webhook goes sideways
    //   - Edit the packet content on behalf of the family from the
    //     registration detail page's inline editor (sizes, medical
    //     narrative, pickup permissions). Admin needs full control
    //     here so the "no more redirecting back to the application
    //     form" rule extends to registration-phase data too.
    //
    // File-upload columns (birth_certificate, transcripts, etc.) are
    // deliberately NOT on the allowlist — those go through their
    // own upload-to-Xano flow on the parent side and aren't
    // editable as inline text. Same for `last_updated` /
    // `last_edited_time`, which `xano.studentRegistration.update`
    // auto-stamps for every writer.
    //
    // The audit columns `registration_confirmed_admin_time` and
    // `is_registration_admin_confirm_admin` are NOT on the body
    // allowlist; we stamp them here from the requesting admin's
    // display name + Date.now() based on the bool's new value.
    // Mirrors the audit pattern in `/api/admin/family-progress`.
    const ALLOWED: Array<keyof XanoStudentRegistration> = [
      "registrationConfirmed",
      "liability_waiver_pandadoc_id",
      "liability_waiver_status",
      "liability_waiver_sent_at",
      "liability_waiver_pdf_url",
      // Uniform & Activities
      "shirt_size",
      "pant_size",
      "swim_level",
      // Health & Medical — booleans + scalars
      "is_student_on_medicaid",
      "medicaid_number",
      "medicaid_provider",
      "carry_epi_pen",
      // Health & Medical — narrative text
      "allergies",
      "dietary_restrictions",
      "prescription_medications",
      "health_conditions",
      "vision_impairments",
      "hearing_impairments",
      "epipen_explainer",
      "permission_for_acetaminophen",
      "additional_health_information",
      "interested_in_counseling_services",
      "iep_description",
      // Pickup permissions
      "other_adults_approved_for_pickup",
      "prohibited_adults",
      // Admin-only placement (not parent-facing). `crew_assignment`
      // changes auto-stamp the prior crew + change time below; the
      // audit columns themselves (`previous_crew_assignment`,
      // `crew_assignment_change`) are deliberately NOT on this
      // allowlist so the client can't spoof the history.
      "grade_level",
      "crew_assignment",
      // Per-student billing math lives on the application row now,
      // not the packet — use `/api/admin/student-registration/by-student`
      // (which writes to the app row + re-prices Stripe) instead of
      // PATCHing those columns here.
      // SUFS reconciliation (the /admin/sufs page) — the three-stage
      // pipeline bools + the free-text note. Each bool is coerced to
      // a real boolean and auto-stamps its audit pair below; the note
      // gets the empty-string sentinel treatment. The audit columns
      // themselves (`*_time` / `*_by` / `*_confirmed*`) are
      // deliberately NOT listed — the route owns them.
      "sufs_enrollment_request_sent",
      "sufs_enrollment_request_notes",
      "sufs_parent_enrollment_confirmation",
      "sufs_q1_payment",
      "sufs_q2_payment",
      "sufs_q3_payment",
      "sufs_q4_payment",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    // Auto-stamp the audit pair when `registrationConfirmed` is in
    // the patch. true → time = now, admin = display name; false →
    // time = null, admin = "". Keeps the audit in sync with whatever
    // bool admin just flipped.
    if ("registrationConfirmed" in patch) {
      const next = patch.registrationConfirmed === true;
      patch.registration_confirmed_admin_time = next ? Date.now() : null;
      patch.is_registration_admin_confirm_admin = next
        ? admin?.name ?? ""
        : "";
    }

    // Crew-assignment change tracking. When admin moves a student to
    // a different crew, snapshot the prior crew + stamp the change
    // time server-side — same audit philosophy as the
    // `registrationConfirmed` pair above (kept off the body allowlist
    // so the history can't be spoofed). Reads the current packet to
    // get the prior crew; no-op when the crew isn't actually changing
    // (so editing only `grade_level` never bumps the crew history).
    if ("crew_assignment" in patch) {
      const current = await xano.studentRegistration.getById(id);
      const prevCrew = (current?.crew_assignment ?? "").trim();
      const nextCrew = String(patch.crew_assignment ?? "").trim();
      if (current && nextCrew !== prevCrew) {
        patch.previous_crew_assignment = prevCrew;
        patch.crew_assignment_change = Date.now();
      }
    }

    // SUFS pipeline bools — coerce each to a real boolean and
    // auto-stamp its audit pair, same treatment as
    // `registrationConfirmed` above. On → time = now, by = admin
    // display name; off → time = null, by = "". (Xano drops the
    // null/"" clears, so read paths gate the stamps on the bool.)
    if ("sufs_enrollment_request_sent" in patch) {
      const next = patch.sufs_enrollment_request_sent === true;
      patch.sufs_enrollment_request_sent = next;
      patch.sufs_enrollment_request_time = next ? Date.now() : null;
      patch.sufs_enrollment_request_by = next ? admin?.name ?? "" : "";
    }
    if ("sufs_parent_enrollment_confirmation" in patch) {
      const next = patch.sufs_parent_enrollment_confirmation === true;
      patch.sufs_parent_enrollment_confirmation = next;
      // Xano's audit columns for the confirmation flip are named
      // `..._request_time/by` — see the note on the type.
      patch.sufs_parent_enrollment_request_time = next ? Date.now() : null;
      patch.sufs_parent_enrollment_request_by = next ? admin?.name ?? "" : "";
    }
    // Quarterly payment confirmations — `sufs_qN_payment_confirmed`
    // is the confirmation TIMESTAMP (not a bool), `_confirmed_by` the
    // admin name.
    for (const q of [1, 2, 3, 4]) {
      const key = `sufs_q${q}_payment`;
      if (key in patch) {
        const next = patch[key] === true;
        patch[key] = next;
        patch[`sufs_q${q}_payment_confirmed`] = next ? Date.now() : null;
        patch[`sufs_q${q}_payment_confirmed_by`] = next
          ? admin?.name ?? ""
          : "";
      }
    }

    // Xano's edit endpoint DROPS empty-string inputs (booleans and
    // integer 0 apply fine). So PATCHing the note to "" to clear it
    // would silently no-op and the stale note would reappear on the
    // next refetch. Persist a single space as the "cleared" sentinel;
    // `/api/admin/sufs` trims it back to "" on read, so the
    // round-trip is invisible to the client.
    if ("sufs_enrollment_request_notes" in patch) {
      const note = String(patch.sufs_enrollment_request_notes ?? "").trim();
      patch.sufs_enrollment_request_notes = note === "" ? " " : note;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    // `last_edited_time` is auto-stamped by `xano.studentRegistration.update`
    // — every caller (admin, parent, PandaDoc) gets it for free, so
    // we don't add it to the patch here.
    const updated = await xano.studentRegistration.update(id, patch);

    // Cascade: when admin verifies a packet (registrationConfirmed
    // flips to true), check whether every active student in the
    // family now has a confirmed packet for the same year. If so,
    // flip the family-level `isRegistration` on the registration
    // progress row so the parent's sidenav reflects "Registration
    // Packet section done" without the parent having to do
    // anything.
    //
    // Best-effort: failures here are logged but don't fail the
    // verify itself. Asymmetric on un-verify — un-verifying ONE
    // student's packet doesn't flip `isRegistration` back to
    // false (the family's overall section status is fuzzier than
    // a single student's verify state). Admin can manually clear
    // it via the section-confirm flow if needed.
    if (
      "registrationConfirmed" in patch &&
      patch.registrationConfirmed === true
    ) {
      try {
        await cascadeFamilyRegistrationCompleted(updated);
      } catch (err) {
        console.error(
          "[/api/admin/student-registration/[id]] cascade to family isRegistration failed:",
          err
        );
      }

      // Cascade 2: mark the student enrolled. The family-level
      // "Confirm Family Registration" flow does this for a whole
      // cohort at once, but a student confirmed on their own —
      // every residential / foster placement, which arrives
      // mid-year after the family was already confirmed — never
      // passes through it, so their `isEnrolled` stayed false and
      // the enrolled roster couldn't show them. Verifying a packet
      // is the same statement that cascade makes, per student.
      //
      // Guarded on `isArchived`: re-verifying an old packet for a
      // student admin has since unenrolled must not quietly pull
      // them back into the roster. Best-effort like the cascade
      // above — the verify itself has already succeeded.
      try {
        await cascadeStudentEnrolled(updated);
      } catch (err) {
        console.error(
          "[/api/admin/student-registration/[id]] cascade to student isEnrolled failed:",
          err
        );
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Admin-only DELETE for one `registration_student_registration` packet.
 * Hard-removes the row — used by the residential-family registration
 * detail page to delete a specific student's registration packet (foster
 * placements churn mid-year). The application row + student record are
 * left intact; this only drops the packet.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid packet id" }, { status: 400 });
    }
    await xano.studentRegistration.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * After admin verifies a per-student packet, walk the family's
 * active applications for the same year and check whether every
 * one of them has a confirmed packet. If yes, flip the family's
 * `registration_student_registration_progress.isRegistration` to
 * `true` so the parent-side sidenav shows the section as complete.
 *
 * Skipped when:
 *   - The family has no active apps for the year (shouldn't happen
 *     post-acceptance but defensively handled — we don't want to
 *     mark `isRegistration=true` on an empty cohort)
 *   - Any active student is missing a packet, or has one that
 *     isn't confirmed yet
 *
 * Doesn't downgrade `isRegistration` to `false` — that's a
 * different concern handled by the parent-side cascade when they
 * unlock + edit something.
 */
/**
 * Flip `student.isEnrolled = true` for the student whose packet admin
 * just verified.
 *
 * The family-level confirm flow
 * (`/api/admin/registration-progress` → `cascadeIsEnrolledTrue`) does
 * this for a whole cohort when admin confirms a family's registration.
 * A student verified on their own never reaches it — which is every
 * residential / foster placement, since those are added mid-year, after
 * their family's confirmation already fired and will not fire again.
 * Their `isEnrolled` therefore stayed false forever and the enrolled
 * roster had nowhere to put them.
 *
 * Skipped when the student is archived (admin-unenrolled — re-verifying
 * an old packet must not re-enroll them) or already flagged, so the
 * common case costs one read and no write.
 */
async function cascadeStudentEnrolled(
  packet: XanoStudentRegistration
): Promise<void> {
  const studentId = Number(packet.registration_students_id);
  if (!studentId) return;
  const student = await xano.students.getById(studentId);
  if (student.isArchived === true) return;
  if (student.isEnrolled === true) return;
  await xano.students.updateOnAdminGroup(studentId, { isEnrolled: true });
}

async function cascadeFamilyRegistrationCompleted(
  packet: XanoStudentRegistration
): Promise<void> {
  const studentId = Number(packet.registration_students_id);
  const yearId = Number(packet.registration_school_years_id);
  if (!studentId || !yearId) return;

  // Find the family. Packets carry a student FK but no direct family
  // FK, so we need the student row. Prefer the addon-embedded student
  // (`_registration_students_2`) when present — Xano's packet GET
  // includes it — and fall back to a `students.getById` hop only
  // when the embed is missing (list endpoints, older callers).
  const familyId =
    packet._registration_students_2?.registration_families_id ??
    (await xano.students.getById(studentId)).registration_families_id;
  if (!familyId) return;

  // Active apps for this family + year define the cohort that has
  // to be fully verified before isRegistration can flip true.
  const apps = await xano.applications.getByFamilyId(familyId);
  const activeApps = apps.filter(
    (a) =>
      Number(a.registration_school_years_id) === yearId &&
      a.isActive !== false
  );
  if (activeApps.length === 0) return;

  // Pull every packet for the year once, then index by student id
  // so the per-app lookup below is O(1).
  const allPackets = await xano.studentRegistration.getByYear(yearId);
  const packetByStudent = new Map<number, XanoStudentRegistration>();
  for (const p of allPackets) {
    packetByStudent.set(Number(p.registration_students_id), p);
  }
  // The just-updated packet we wrote above might not be in the
  // year-scoped fetch yet (cache races, etc.); slot it in by hand.
  packetByStudent.set(studentId, packet);

  const allConfirmed = activeApps.every((app) => {
    const sId = Number(app.registration_students_id);
    const p = packetByStudent.get(sId);
    return p?.registrationConfirmed === true;
  });
  if (!allConfirmed) return;

  // Resolve-or-create the family progress row, then flip
  // `isRegistration` if it isn't already true. Last-edited bump is
  // automatic via the resolve/update flow.
  const progress = await xano.studentRegistrationProgress.resolve(
    familyId,
    yearId
  );
  if (progress.isRegistration !== true) {
    await xano.studentRegistrationProgress.update(progress.id, {
      isRegistration: true,
      last_edited: Date.now(),
    });
  }
}

