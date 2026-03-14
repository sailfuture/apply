import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

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
    return NextResponse.json({ error: "No family found" }, { status: 400 });
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

  const fields =
    type === "liability_waiver"
      ? {
          liability_waiver_pandadoc_id: null,
          liability_waiver_status: null,
          liability_waiver_sent_at: null,
          liability_waiver_pdf_url: null,
        }
      : {
          enrollment_agreement_pandadoc_id: null,
          enrollment_agreement_status: null,
          enrollment_agreement_sent_at: null,
          enrollment_agreement_pdf_url: null,
        };

  await xano.applications.update(applicationId, fields as Record<string, unknown>);

  return NextResponse.json({ success: true });
}
