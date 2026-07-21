import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Begin re-application for a returning family.
 *
 * Bootstraps everything the family needs to re-apply for the next academic
 * year:
 *   1. A `registration_application` row for each accepted student in the
 *      family for the new year (carries forward grade + transport prefs as
 *      defaults; admin can override during review).
 *   2. The unified `registration_family_application_progress` row for
 *      { family, newYear } with `type = "Re-Enrollment"` so the apply
 *      flow knows to skip Initial Testing (NWEA scores carry forward
 *      from prior apps — auto-completed below) and surface re-enrollment
 *      copy/prefill where relevant. Re-applicants share the same
 *      `/apply/year/[yearId]/*` URL space as new applicants now;
 *      the `type` discriminator drives any flow-specific behavior.
 *   3. A fresh `registration_student_registration` packet per student
 *      for the new year (medical / emergency / pickup carry over,
 *      waiver pandadoc IDs reset).
 *
 * Idempotent — safe to call more than once. Doesn't duplicate application
 * rows that already exist for the new year; resolves-or-creates the
 * progress row instead of recreating it. Returns the (created or existing)
 * progress row + a target redirect path the client can navigate to.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const yearId = Number(body?.yearId);
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }

  // 1. Resolve every accepted student on this family. Re-application
  //    only applies to students that were accepted previously — new
  //    siblings should go through the normal application flow.
  const students = await xano.students.getByFamilyId(familyId);
  const acceptedStudents = students.filter((s) => s.isAccepted === true);

  // 2. Look at existing applications for the new year so we don't
  //    re-create rows that are already there.
  const familyApps = await xano.applications.getByFamilyId(familyId);
  const existingForYear = new Set(
    familyApps
      .filter((a) => a.registration_school_years_id === yearId)
      .map((a) => a.registration_students_id)
  );

  // 3. Pull last year's app per student so we can carry forward grade +
  //    transport defaults onto the new application.
  const lastByStudent = new Map<number, typeof familyApps[number]>();
  for (const app of familyApps) {
    const prior = lastByStudent.get(app.registration_students_id);
    if (
      !prior ||
      app.registration_school_years_id > prior.registration_school_years_id
    ) {
      lastByStudent.set(app.registration_students_id, app);
    }
  }

  const created: number[] = [];
  for (const student of acceptedStudents) {
    if (existingForYear.has(student.id)) continue;
    const prev = lastByStudent.get(student.id);

    // Start by cloning every field from the previous year's application
    // (minus id + created_at, which Xano assigns on insert), then override
    // the bits that genuinely need to be reset for the new academic year.
    // Carrying everything else forward lets families re-apply with their
    // existing answers populated — they review and update what's changed
    // rather than typing the same data twice.
    const baseClone = prev
      ? (() => {
          const { id, created_at, ...rest } = prev;
          void id;
          void created_at;
          return rest;
        })()
      : {
          registration_students_id: student.id,
          registration_families_id: familyId,
          registration_application_status_id: 0,
          registration_parents_id: 0,
          type: "Re-Enrollment",
          current_previous_school: "",
          describe_student_opportunities_for_growth: "",
          describe_student_strengths: "",
          sufs_type: "",
          sufs_status: "",
          sufs_award_id: 0,
          is_bus_transportation: false,
          bus_stop: "",
          test_scores: null,
          nwea_testing_complete: false,
          nwea_testing_scheduled: false,
          last_grade_completed: "",
          current_grade: "",
          isSubmitted: false,
          isOffered: false,
          isAccepted: false,
          // Per-student tuition columns moved onto the per-year
          // packet; the app-row column is kept as `null` to satisfy
          // the type contract without implying a $0 determination.
          opportunity_scholarship_award_amount: null,
          enrollment_agreement_pandadoc_id: "",
          enrollment_agreement_status: "",
          enrollment_agreement_sent_at: null,
          enrollment_agreement_pdf_url: "",
        };

    const fresh = await xano.applications.create({
      ...baseClone,
      // Identity + year — always set to the new year's ids regardless of
      // what the cloned row had.
      registration_students_id: student.id,
      registration_families_id: familyId,
      registration_school_years_id: yearId,
      type: "Re-Enrollment",
      // Grade bumps forward; last_grade_completed picks up where the
      // previous current_grade left off.
      last_grade_completed:
        prev?.current_grade ?? prev?.last_grade_completed ?? "",
      current_grade: bumpGrade(prev?.current_grade ?? ""),
      // Status fields reset — re-applying families need to be re-offered
      // and re-accepted by admin for the new year.
      sufs_status: "",
      sufs_award_id: 0,
      isSubmitted: false,
      isOffered: false,
      isAccepted: false,
      // New year's application starts active regardless of last
      // year's flag. Admin views filter on `isActive=true`.
      isActive: true,
      // Per-student tuition columns live on the per-year packet
      // (cloned below). App-row column kept as `null` per the
      // type contract; admin re-determines via the Scholarship
      // Determination card. PandaDoc identifiers reset — last
      // year's signed docs aren't valid for this year's
      // enrollment.
      opportunity_scholarship_award_amount: null,
      enrollment_agreement_pandadoc_id: "",
      enrollment_agreement_status: "",
      enrollment_agreement_sent_at: null,
      enrollment_agreement_pdf_url: "",
      // NWEA scores carry over (admin can flip if they want a new test);
      // scheduling resets so the family can pick a new date if needed.
      nwea_testing_scheduled: false,
    });
    created.push(fresh.id);
  }

  // 4. Duplicate each student's `registration_student_registration` packet
  //    for the new year. The packet holds medical / health / pickup /
  //    uniform info — none of which a parent should re-type if it hasn't
  //    changed. Each new packet's id also gets appended to the student's
  //    `registration_student_registration_id` array so the student row
  //    accumulates a lineage of packets across years.
  for (const student of acceptedStudents) {
    // Skip if a packet already exists for { student, newYear } (idempotent
    // re-runs of this endpoint shouldn't dupe).
    const existingPackets = await xano.studentRegistration.getByStudentId(
      student.id
    );
    const existingForThisYear =
      existingPackets &&
      Number(existingPackets.registration_school_years_id) === yearId;
    if (existingForThisYear) continue;

    const prevPacket = existingPackets;
    if (!prevPacket) continue;

    // Spread previous packet's data, then override year + reset
    // year-specific fields. Liability waiver IDs reset because last
    // year's signed waiver isn't valid for the new year.
    const { id, created_at, ...prevFields } = prevPacket;
    void id;
    void created_at;
    const newPacket = await xano.studentRegistration.create({
      ...prevFields,
      registration_students_id: student.id,
      registration_school_years_id: yearId,
      registration_type_id: prevPacket.registration_type_id,
      liability_waiver_pandadoc_id: "",
      liability_waiver_status: "",
      liability_waiver_sent_at: null,
      liability_waiver_pdf_url: "",
      registrationConfirmed: false,
      // SUFS enrollment is a per-year action — last year's pipeline
      // state (request sent / parent confirmed / quarterly payments,
      // plus notes and audit stamps) must not carry into the new
      // year's packet, or the student would show as already handled
      // on the /admin/sufs reconciliation list and get skipped on
      // the Step Up portal.
      sufs_enrollment_request_sent: false,
      sufs_enrollment_request_notes: "",
      sufs_enrollment_request_time: null,
      sufs_enrollment_request_by: "",
      sufs_parent_enrollment_confirmation: false,
      sufs_parent_enrollment_request_time: null,
      sufs_parent_enrollment_request_by: "",
      sufs_q1_payment: false,
      sufs_q1_payment_confirmed: null,
      sufs_q1_payment_confirmed_by: "",
      sufs_q2_payment: false,
      sufs_q2_payment_confirmed: null,
      sufs_q2_payment_confirmed_by: "",
      sufs_q3_payment: false,
      sufs_q3_payment_confirmed: null,
      sufs_q3_payment_confirmed_by: "",
      sufs_q4_payment: false,
      sufs_q4_payment_confirmed: null,
      sufs_q4_payment_confirmed_by: "",
    });

    // Append the new packet ID to the student's lineage list. Best-effort
    // — if Xano hiccups on the student PATCH, the packet itself is still
    // saved and the bootstrap doesn't fail.
    try {
      const fresh = await xano.students.getById(student.id);
      const list: number[] = Array.isArray(
        (fresh as unknown as { registration_student_registration_id?: number[] })
          .registration_student_registration_id
      )
        ? ((fresh as unknown as { registration_student_registration_id: number[] })
            .registration_student_registration_id)
        : [];
      if (!list.includes(newPacket.id)) {
        await xano.students.update(student.id, {
          registration_student_registration_id: [...list, newPacket.id],
        });
      }
    } catch (err) {
      console.error(
        `Failed to append packet ${newPacket.id} to student ${student.id}:`,
        err
      );
    }
  }

  // 5. Resolve-or-create the unified family-application-progress row
  //    and stamp it as a re-enrollment. Setting `testing_completed: true`
  //    here is what lets re-applicants skip the Initial Testing (NWEA)
  //    step in the apply flow — the section bool is the same one
  //    `useApplicationSteps` reads to render the sidenav. Auto-completing
  //    it on bootstrap means re-enrollment families never see an
  //    NWEA gate they can't satisfy (their scores are already on
  //    file via the cloned `test_scores` field on each app row above).
  //    Also append the new application IDs to the row's
  //    `registration_application_id` array so the per-family app set
  //    is addressable straight off the progress row.
  const famProgress = await xano.familyApplicationProgress.resolve(
    familyId,
    yearId
  );
  const existingIds = Array.isArray(famProgress.registration_application_id)
    ? famProgress.registration_application_id
    : [];
  const merged = Array.from(new Set([...existingIds, ...created]));
  const needsUpdate =
    famProgress.type !== "Re-Enrollment" ||
    famProgress.testing_completed !== true ||
    merged.length !== existingIds.length;
  if (needsUpdate) {
    try {
      await xano.familyApplicationProgress.update(famProgress.id, {
        type: "Re-Enrollment",
        testing_completed: true,
        registration_application_id: merged,
        last_edited: Date.now(),
      });
    } catch (err) {
      console.error(
        "Failed to stamp re-enrollment on family progress:",
        err
      );
    }
  }

  return NextResponse.json(
    {
      progressId: famProgress.id,
      createdApplicationIds: created,
      // Re-applicants land on the same /apply/year/[yearId] URL space
      // as new applicants. The progress row's `type === "Re-Enrollment"`
      // discriminator drives flow-specific UI (NWEA skip, prefilled
      // student review, re-enrollment copy in headers, etc.).
      redirectTo: `/apply/year/${yearId}`,
    },
    { status: 200 }
  );
}

/** Best-effort grade bump — turns "8" → "9", "K" → "1", "9th" → "10th",
 *  etc. Falls back to the prior value if we can't parse it; admin can
 *  correct during review. */
function bumpGrade(prior: string): string {
  if (!prior) return "";
  const trimmed = prior.trim();
  if (/^k(indergarten)?$/i.test(trimmed)) return "1st";
  const match = trimmed.match(/^(\d+)\s*(st|nd|rd|th)?/i);
  if (!match) return prior;
  const n = Number(match[1]) + 1;
  const suffix = match[2] ?? "";
  return suffix ? `${n}${suffix.toLowerCase()}` : String(n);
}
