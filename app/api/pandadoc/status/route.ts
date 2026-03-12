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
      const application = await xano.applications.getById(appId);

      if (application && application.registration_families_id === familyId) {
        const statusField = type === "liability_waiver"
          ? "liability_waiver_status"
          : "enrollment_agreement_status";

        if (application[statusField] !== normalizedStatus) {
          const updateData: Record<string, unknown> = {
            [statusField]: normalizedStatus,
          };

          if (normalizedStatus === "completed") {
            const pdfUrlField = type === "liability_waiver"
              ? "liability_waiver_pdf_url"
              : "enrollment_agreement_pdf_url";
            updateData[pdfUrlField] = getDocumentDownloadUrl(documentId);
          }

          await xano.applications.update(appId, updateData);
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
