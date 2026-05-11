import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  sendDocument,
  createSigningSession,
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
  const statusField = type === "liability_waiver"
    ? "liability_waiver_status"
    : "enrollment_agreement_status";

  const sourceRecord = (packetRow ?? progressRow ?? application) as unknown as Record<
    string,
    unknown
  >;
  const existingDocId = sourceRecord[pandadocIdField] as string | null;
  const existingStatus = sourceRecord[statusField] as string | null;

  if (existingStatus === "completed") {
    return NextResponse.json(
      { error: "Document already signed" },
      { status: 409 }
    );
  }

  // The signing identity is whichever parent is logged into Clerk right now.
  // Either parent on the family can sign — the document is tokenized to
  // their name and the signing session is addressed to their email.
  const family = await xano.families.getById(familyId);
  const recipientEmail = user.emailAddresses[0]?.emailAddress ?? "";
  const recipientFirstName = user.firstName ?? "";
  const recipientLastName = user.lastName ?? "";

  if (existingDocId) {
    try {
      const sessionId = await createSigningSession(existingDocId, recipientEmail);
      return NextResponse.json({
        documentId: existingDocId,
        sessionId,
        resumed: true,
      });
    } catch {
      // Document may have expired or been deleted; create a new one below
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
        "parent.first_name": recipientFirstName,
        "parent.last_name": recipientLastName,
        "parent.email": recipientEmail,
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
