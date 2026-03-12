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

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
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

  const application = await xano.applications.getById(Number(applicationId));
  if (!application || application.registration_families_id !== familyId) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const owns =
    application.liability_waiver_pandadoc_id === documentId ||
    application.enrollment_agreement_pandadoc_id === documentId;
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
