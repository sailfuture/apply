import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { getDocumentDownloadUrl } from "@/lib/pandadoc";

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const documentId = req.nextUrl.searchParams.get("documentId");
  const applicationId = req.nextUrl.searchParams.get("applicationId");

  if (!documentId || !applicationId) {
    return NextResponse.json(
      { error: "documentId and applicationId are required" },
      { status: 400 }
    );
  }

  // Ownership check via family's own apps — robust to Xano returning the
  // relation as an expanded object rather than a scalar id.
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

  // Ownership check — accept the document if its ID is stored in
  // either of the two tables a PandaDoc ID can live in for this
  // family:
  //
  //   1. `registration_student_registration` (the packet — canonical
  //      location for liability waivers, per-student per-year)
  //   2. `registration_student_registration_progress` (per-family
  //      per-year — canonical location for enrollment agreements)
  //
  // The waiver columns used to live on `registration_application`
  // too, but those have been removed; the packet is the single source
  // of truth now.
  let owns =
    application.enrollment_agreement_pandadoc_id === documentId;

  if (!owns) {
    const progressRow =
      await xano.studentRegistrationProgress.getByFamilyAndYear(
        familyId,
        application.registration_school_years_id
      );
    owns = progressRow?.enrollment_agreement_pandadoc_id === documentId;
  }

  if (!owns) {
    try {
      const packet = await xano.studentRegistration.getByStudentAndYear(
        application.registration_students_id,
        application.registration_school_years_id
      );
      owns = packet?.liability_waiver_pandadoc_id === documentId;
    } catch {
      // Ignore — leaves `owns = false` and we fall through to 404.
    }
  }

  if (!owns) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    const apiKey = process.env.PANDADOC_API_KEY;
    if (!apiKey) throw new Error("PANDADOC_API_KEY is not set");

    const url = getDocumentDownloadUrl(documentId);
    const res = await fetch(url, {
      headers: {
        Authorization: `API-Key ${apiKey}`,
      },
      redirect: "follow",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PandaDoc download failed (${res.status}): ${text}`);
    }

    const pdfBuffer = await res.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${documentId}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PandaDoc download error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to download PDF" },
      { status: 500 }
    );
  }
}
