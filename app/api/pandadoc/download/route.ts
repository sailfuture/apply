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

  // Ownership + signed-status check. The document is downloadable
  // iff (a) its ID is stored on a row owned by this family, AND (b)
  // that row's status field is `"completed"`. Both halves matter:
  //
  //   - Ownership prevents one family from grabbing another family's
  //     signed PDFs by guessing document IDs.
  //   - The signed-status gate prevents serving the pre-signature
  //     (or post-revert) bytes of a PandaDoc envelope. Without it,
  //     anyone with a docId-on-their-family can pull a half-signed
  //     or admin-voided PDF as if it were the legal signed copy.
  //     The UI side has a latching `isEnrollment` boolean that can
  //     outlive a PandaDoc-side revert (see `pandadoc/status` for
  //     the downgrade logic) — even with that fixed, we keep this
  //     server-side gate as defense-in-depth.
  //
  // Three rows can carry a PandaDoc ID for a family:
  //   1. `registration_application` — legacy EA mirror (rarely
  //      populated today, but check for completeness)
  //   2. `registration_student_registration_progress` — canonical
  //      EA location, per-family per-year
  //   3. `registration_student_registration` — packet, canonical
  //      liability-waiver location, per-student per-year
  let owns = false;
  let signed = false;

  if (application.enrollment_agreement_pandadoc_id === documentId) {
    owns = true;
    signed = application.enrollment_agreement_status === "completed";
  }

  if (!owns) {
    const progressRow =
      await xano.studentRegistrationProgress.getByFamilyAndYear(
        familyId,
        application.registration_school_years_id
      );
    if (progressRow?.enrollment_agreement_pandadoc_id === documentId) {
      owns = true;
      signed = progressRow.enrollment_agreement_status === "completed";
    }
  }

  if (!owns) {
    try {
      const packet = await xano.studentRegistration.getByStudentAndYear(
        application.registration_students_id,
        application.registration_school_years_id
      );
      if (packet?.liability_waiver_pandadoc_id === documentId) {
        owns = true;
        signed = packet.liability_waiver_status === "completed";
      }
    } catch {
      // Ignore — leaves `owns = false` and we fall through to 404.
    }
  }

  if (!owns) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!signed) {
    return NextResponse.json(
      { error: "Document has not been signed yet" },
      { status: 403 }
    );
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
