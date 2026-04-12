import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  sendDocument,
  createSigningSession,
  getTemplateId,
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

  const application = await xano.applications.getById(applicationId);
  if (!application || Number(application.registration_families_id) !== familyId) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const pandadocIdField = type === "liability_waiver"
    ? "liability_waiver_pandadoc_id"
    : "enrollment_agreement_pandadoc_id";
  const statusField = type === "liability_waiver"
    ? "liability_waiver_status"
    : "enrollment_agreement_status";

  const existingDocId = application[pandadocIdField] as string | null;
  const existingStatus = application[statusField] as string | null;

  if (existingStatus === "completed") {
    return NextResponse.json(
      { error: "Document already signed" },
      { status: 409 }
    );
  }

  if (existingDocId) {
    try {
      const sessionId = await createSigningSession(
        existingDocId,
        user.emailAddresses[0]?.emailAddress ?? ""
      );
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
    const family = await xano.families.getById(familyId);
    const student = await xano.students.getById(
      application.registration_students_id
    );

    const templateId = getTemplateId(type);
    const recipientEmail =
      user.emailAddresses[0]?.emailAddress ?? "";
    const recipientFirstName = user.firstName ?? "";
    const recipientLastName = user.lastName ?? "";

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

    const sentAtField = type === "liability_waiver"
      ? "liability_waiver_sent_at"
      : "enrollment_agreement_sent_at";

    await xano.applications.update(applicationId, {
      [pandadocIdField]: doc.id,
      [statusField]: "sent",
      [sentAtField]: new Date().toISOString(),
    });

    return NextResponse.json({ documentId: doc.id, sessionId });
  } catch (err) {
    console.error("PandaDoc create error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create document" },
      { status: 500 }
    );
  }
}
