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

  // Ownership check via the family's own app list — avoids flaky 404s from
  // Xano returning registration_families_id as a relation object.
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

  if (type === "liability_waiver") {
    // Per-student — reset waiver fields on the packet
    // (`registration_student_registration`). Resolved-or-created so
    // a reset request for a doc whose packet was deleted out from
    // under it still lands on a clean row instead of 404'ing.
    const packetRow = await xano.studentRegistration.resolve(
      application.registration_students_id,
      application.registration_school_years_id
    );
    await xano.studentRegistration.update(packetRow.id, {
      liability_waiver_pandadoc_id: "",
      liability_waiver_status: "",
      liability_waiver_sent_at: null,
      liability_waiver_pdf_url: "",
    });
  } else {
    // Family-level — reset fields on the registration progress row, plus
    // un-latch `isEnrollment` so the section falls back to in-progress.
    const progressRow = await xano.studentRegistrationProgress.resolve(
      familyId,
      application.registration_school_years_id
    );
    await xano.studentRegistrationProgress.update(progressRow.id, {
      enrollment_agreement_pandadoc_id: "",
      enrollment_agreement_status: "",
      enrollment_agreement_sent: null,
      enrollment_agreement_pdf_url: "",
      is_enrollment_agreement_signed: false,
      isEnrollment: false,
    });
  }

  return NextResponse.json({ success: true });
}
