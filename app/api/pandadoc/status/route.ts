import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { getDocumentStatus, getDocumentDownloadUrl } from "@/lib/pandadoc";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const documentId = req.nextUrl.searchParams.get("documentId");
  const applicationId = req.nextUrl.searchParams.get("applicationId");
  const type = req.nextUrl.searchParams.get("type") as
    | "liability_waiver"
    | "enrollment_agreement"
    | null;

  if (!documentId) {
    return NextResponse.json(
      { error: "documentId is required" },
      { status: 400 }
    );
  }

  try {
    const doc = await getDocumentStatus(documentId);

    const pandaStatus = doc.status;
    const normalizedStatus =
      pandaStatus === "document.completed"
        ? "completed"
        : pandaStatus === "document.viewed"
          ? "viewed"
          : pandaStatus === "document.sent"
            ? "sent"
            : pandaStatus === "document.draft"
              ? "draft"
              : pandaStatus;

    if (
      applicationId &&
      type &&
      (normalizedStatus === "completed" || normalizedStatus === "viewed")
    ) {
      const appId = Number(applicationId);
      // Ownership check via family's own app list — same pattern as the
      // other PandaDoc routes, avoids flaky 404s from relation-vs-scalar.
      const familyApps = await xano.applications.getByFamilyId(familyId);
      const application = familyApps.find((a) => Number(a.id) === appId);

      if (application) {
        if (type === "liability_waiver") {
          // Per-student — write to the packet
          // (`registration_student_registration`). Resolved-or-created
          // so a status callback for a doc the parent kicked off
          // before completing the rest of their packet still has a
          // row to land on.
          const packetRow = await xano.studentRegistration.resolve(
            application.registration_students_id,
            application.registration_school_years_id
          );
          if (packetRow.liability_waiver_status !== normalizedStatus) {
            const updateData: Partial<
              import("@/lib/xano").XanoStudentRegistration
            > = {
              liability_waiver_status: normalizedStatus,
            };
            if (normalizedStatus === "completed") {
              updateData.liability_waiver_pdf_url =
                getDocumentDownloadUrl(documentId);
            }
            await xano.studentRegistration.update(packetRow.id, updateData);
          }
        } else {
          // Enrollment agreement is family-level — write to the
          // registration progress row. Also latches `isEnrollment` when
          // the document is completed so the sidenav and enrolled
          // dashboard reflect it without a second PATCH.
          const progressRow = await xano.studentRegistrationProgress.resolve(
            familyId,
            application.registration_school_years_id
          );
          if (progressRow.enrollment_agreement_status !== normalizedStatus) {
            const updateData: Partial<
              import("@/lib/xano").XanoStudentRegistrationProgress
            > = {
              enrollment_agreement_status: normalizedStatus,
            };
            if (normalizedStatus === "completed") {
              updateData.enrollment_agreement_pdf_url = getDocumentDownloadUrl(documentId);
              updateData.is_enrollment_agreement_signed = true;
              updateData.isEnrollment = true;
            }
            await xano.studentRegistrationProgress.update(
              progressRow.id,
              updateData
            );
          }
        }
      }
    }

    return NextResponse.json({
      documentId,
      status: normalizedStatus,
      name: doc.name,
    });
  } catch (err) {
    console.error("PandaDoc status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get status" },
      { status: 500 }
    );
  }
}
