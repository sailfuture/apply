import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  sendDocument,
  createSigningSession,
  getDocumentStatus,
  getTemplateId,
  getTemplateRole,
  waitForDocumentStatus,
} from "@/lib/pandadoc";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = Number(user.publicMetadata.registration_families_id);
  if (!familyId) {
    return NextResponse.json(
      { error: "No family found" },
      { status: 400 }
    );
  }

  const { type, applicationId } = await req.json();

  if (!type || !["liability_waiver", "enrollment_agreement"].includes(type)) {
    return NextResponse.json(
      { error: "type must be 'liability_waiver' or 'enrollment_agreement'" },
      { status: 400 }
    );
  }

  if (!applicationId) {
    return NextResponse.json(
      { error: "applicationId is required" },
      { status: 400 }
    );
  }

  // Ownership check: look up the application inside the family's own app
  // list rather than fetching it directly. This avoids flaky 404s caused by
  // Xano returning `registration_families_id` as an expanded relation
  // object (vs. a scalar id) — which breaks a raw `Number(...)` compare.
  const familyApps = await xano.applications.getByFamilyId(familyId);
  const application = familyApps.find(
    (a) => Number(a.id) === Number(applicationId)
  );
  if (!application) {
    return NextResponse.json(
      { error: "Application not found for this family" },
      { status: 404 }
    );
  }

  // Resolve whichever record this doc type lives on so the field
  // lookups + writes below target the right table:
  //   - waiver → per-student `registration_student_registration`
  //     (the packet). Resolved-or-created so the parent can sign a
  //     waiver before they've started filling out the rest of the
  //     packet.
  //   - enrollment agreement → family-level
  //     `registration_student_registration_progress` row.
  const packetRow =
    type === "liability_waiver"
      ? await xano.studentRegistration.resolve(
          application.registration_students_id,
          application.registration_school_years_id
        )
      : null;
  const progressRow =
    type === "enrollment_agreement"
      ? await xano.studentRegistrationProgress.resolve(
          familyId,
          application.registration_school_years_id
        )
      : null;

  const pandadocIdField = type === "liability_waiver"
    ? "liability_waiver_pandadoc_id"
    : "enrollment_agreement_pandadoc_id";

  const sourceRecord = (packetRow ?? progressRow ?? application) as unknown as Record<
    string,
    unknown
  >;
  const existingDocId = sourceRecord[pandadocIdField] as string | null;
  // `existingStatus` used to early-return 409 here for completed docs,
  // but that's wrong when admin has deleted the PandaDoc envelope —
  // the local row still says "completed" while PandaDoc no longer has
  // anything. The resume-or-recreate path below handles both cases:
  // a still-valid completed doc lets the user resume the signing
  // session (PandaDoc returns a no-op for completed envelopes); a
  // deleted/expired doc throws, which falls through to clearing the
  // stale metadata + creating a fresh envelope.

  // The signing identity AND the `parent.*` tokens/fields all come
  // from whichever parent is currently logged into Clerk. The
  // document represents the act of THIS parent signing — using a
  // different name on the doc body than on the signature recipient
  // would create a legal/auditing mismatch (and was confusing in
  // practice when the lowest-id parent on file diverged from the
  // person actually clicking Sign). Either parent on the family can
  // sign; whoever does signs as themselves.
  const family = await xano.families.getById(familyId);
  const recipientEmail = user.emailAddresses[0]?.emailAddress ?? "";
  const recipientFirstName = user.firstName ?? "";
  const recipientLastName = user.lastName ?? "";
  const docParentFirstName = recipientFirstName;
  const docParentLastName = recipientLastName;
  const docParentEmail = recipientEmail;

  // Helper — wipes the stale Xano metadata so the fresh-create path
  // below writes onto a clean row. Used whenever the existing
  // PandaDoc envelope is unusable (deleted in admin dashboard,
  // voided, etc.). Best-effort: the fresh-create write below
  // overwrites the id + status either way.
  const wipeStaleMetadata = async () => {
    if (type === "enrollment_agreement" && progressRow) {
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          enrollment_agreement_pandadoc_id: "",
          enrollment_agreement_status: "",
          enrollment_agreement_sent: null,
          enrollment_agreement_pdf_url: "",
          is_enrollment_agreement_signed: false,
          isEnrollment: false,
        })
        .catch(() => {});
    } else if (type === "liability_waiver" && packetRow) {
      await xano.studentRegistration
        .update(packetRow.id, {
          liability_waiver_pandadoc_id: "",
          liability_waiver_status: "",
          liability_waiver_sent_at: null,
          liability_waiver_pdf_url: "",
        })
        .catch(() => {});
    }
  };

  if (existingDocId) {
    // Check the doc's actual status on PandaDoc BEFORE attempting to
    // resume — `createSigningSession` doesn't reliably throw for
    // every unusable state. PandaDoc returns a valid session for
    // some statuses (e.g. trashed-but-not-purged documents,
    // documents marked for deletion but still queryable) which then
    // hands the parent a broken signing UI. Driving the decision off
    // `document.status` lets us recover cleanly:
    //   - draft / sent / viewed → resumable, hand the parent a
    //     session for the in-flight envelope
    //   - anything else (completed, declined, voided, expired,
    //     etc.) OR a thrown error (deleted / not found) → wipe local
    //     metadata, fall through to creating a fresh envelope
    const RESUMABLE_STATUSES = new Set([
      "document.draft",
      "document.sent",
      "document.viewed",
      "document.waiting_approval",
    ]);
    let canResume = false;
    try {
      const existing = await getDocumentStatus(existingDocId);
      canResume = RESUMABLE_STATUSES.has(existing.status);
    } catch {
      // 404 / network / etc. — doc is gone. Fall through to wipe +
      // create.
      canResume = false;
    }

    if (canResume) {
      try {
        const sessionId = await createSigningSession(existingDocId, recipientEmail);
        return NextResponse.json({
          documentId: existingDocId,
          sessionId,
          resumed: true,
        });
      } catch {
        // Resume failed even though the status check said resumable.
        // Treat as a deletion — wipe + create fresh below.
        await wipeStaleMetadata();
      }
    } else {
      // Status was non-resumable (or doc gone). Clear the stale
      // metadata before falling through so the fresh-create write
      // lands on a clean row.
      await wipeStaleMetadata();
    }
  }

  try {
    const student = await xano.students.getById(
      application.registration_students_id
    );

    const templateId = getTemplateId(type);

    const docName =
      type === "liability_waiver"
        ? `Liability Waiver – ${student.first_name} ${student.last_name}`
        : `Enrollment Agreement – ${student.first_name} ${student.last_name}`;

    const doc = await createDocumentFromTemplate({
      templateId,
      name: docName,
      recipientEmail,
      recipientFirstName,
      recipientLastName,
      // Per-template role name resolved from the env so admin can
      // adjust the role per template without code changes. Default
      // is "Parent" — override with PANDADOC_LIABILITY_ROLE or
      // PANDADOC_ENROLLMENT_ROLE if the template uses a different
      // role name (e.g. "Recipient", "Signer").
      role: getTemplateRole(type),
      tokens: {
        "family.name": family.family_name,
        "student.first_name": student.first_name,
        "student.last_name": student.last_name,
        "student.full_name": `${student.first_name} ${student.last_name}`,
        // `parent.*` tokens match the signing identity (the Clerk
        // user). The document represents the act of THIS parent
        // signing — keep the doc body's name in sync with the
        // signature recipient so the legal/audit trail stays
        // coherent.
        "parent.first_name": docParentFirstName,
        "parent.last_name": docParentLastName,
        "parent.email": docParentEmail,
      },
      // Pre-fill the interactive form fields on the template so the
      // signer doesn't have to retype their own name / email / their
      // student's name. PandaDoc fields are keyed by the template
      // field's `name` attribute — we send a comprehensive set of
      // common naming conventions (snake_case + dotted variants +
      // capitalized "Participant Name") so the same code works
      // regardless of how the template author named their fields.
      // Fields whose names don't match anything in the template are
      // silently ignored by PandaDoc, so this is safe to over-send.
      fields: {
        // Parent identity — pulled from the Clerk-logged-in user
        // (the actual signer). Mirrors the token semantics above.
        parent_first_name: docParentFirstName,
        parent_last_name: docParentLastName,
        parent_full_name: `${docParentFirstName} ${docParentLastName}`.trim(),
        parent_name: `${docParentFirstName} ${docParentLastName}`.trim(),
        parent_email: docParentEmail,
        "parent.first_name": docParentFirstName,
        "parent.last_name": docParentLastName,
        "parent.full_name": `${docParentFirstName} ${docParentLastName}`.trim(),
        "parent.email": docParentEmail,
        // Student identity — for liability waivers especially, the
        // template's "Participant Name" field should match this
        // student. The waiver is per-student per-year; the create
        // route resolves `student` from `application.registration_students_id`
        // up above, so this is always the right student.
        student_first_name: student.first_name,
        student_last_name: student.last_name,
        student_full_name: `${student.first_name} ${student.last_name}`,
        student_name: `${student.first_name} ${student.last_name}`,
        "student.first_name": student.first_name,
        "student.last_name": student.last_name,
        "student.full_name": `${student.first_name} ${student.last_name}`,
        participant_name: `${student.first_name} ${student.last_name}`,
        participant_first_name: student.first_name,
        participant_last_name: student.last_name,
        "Participant Name": `${student.first_name} ${student.last_name}`,
        // Family-level name (e.g. "Thompson Family") for any field
        // that surfaces the household identity.
        family_name: family.family_name,
        "family.name": family.family_name,
      },
    });

    await waitForDocumentStatus(doc.id, "document.draft");

    await sendDocument(doc.id);

    await waitForDocumentStatus(doc.id, "document.sent");

    const sessionId = await createSigningSession(doc.id, recipientEmail);

    // Target table depends on doc type:
    //   - waiver → per-student `registration_student_registration`
    //     packet (resolved/created above)
    //   - enrollment agreement → family-level `..._progress` row
    //     (absorbed from the retired families_payment table)
    if (type === "enrollment_agreement" && progressRow) {
      await xano.studentRegistrationProgress.update(progressRow.id, {
        enrollment_agreement_pandadoc_id: doc.id,
        enrollment_agreement_status: "sent",
        enrollment_agreement_sent: new Date().toISOString(),
      });
    } else if (type === "liability_waiver" && packetRow) {
      await xano.studentRegistration.update(packetRow.id, {
        liability_waiver_pandadoc_id: doc.id,
        liability_waiver_status: "sent",
        liability_waiver_sent_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ documentId: doc.id, sessionId });
  } catch (err) {
    console.error("PandaDoc create error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create document" },
      { status: 500 }
    );
  }
}
