import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json(null);
  }

  const { searchParams } = new URL(req.url);
  const yearId = Number(searchParams.get("yearId"));
  if (!yearId) {
    return NextResponse.json({ error: "yearId required" }, { status: 400 });
  }

  const payment = await xano.familyPayments.getByFamilyAndYear(familyId, yearId);
  return NextResponse.json(payment);
}

export async function POST(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const body = await req.json();
  const yearId = body.registration_school_years_id;

  if (!yearId) {
    return NextResponse.json({ error: "registration_school_years_id is required" }, { status: 400 });
  }

  // Check if one already exists
  const existing = await xano.familyPayments.getByFamilyAndYear(familyId, yearId);
  if (existing) {
    // Update existing — only update fields that are provided
    const updateData: Record<string, unknown> = {};
    if (body.tuition_reviewed_by) {
      updateData.tuition_reviewed = true;
      updateData.tuition_reviewed_at = Date.now();
      updateData.tuition_reviewed_by = body.tuition_reviewed_by;
    }
    if (body.isFamilyAccepted !== undefined) updateData.isFamilyAccepted = body.isFamilyAccepted;
    if (body.signature) updateData.signature = body.signature;
    if (body.signature_data) updateData.signature_data = body.signature_data;
    if (body.name) updateData.name = body.name;
    if (body.enrollment_agreement_pandadoc_id !== undefined) updateData.enrollment_agreement_pandadoc_id = body.enrollment_agreement_pandadoc_id;
    if (body.enrollment_agreement_status !== undefined) updateData.enrollment_agreement_status = body.enrollment_agreement_status;
    if (body.enrollment_agreement_sent_at !== undefined) updateData.enrollment_agreement_sent_at = body.enrollment_agreement_sent_at;
    if (body.is_enrollment_agreement_signed !== undefined) updateData.is_enrollment_agreement_signed = body.is_enrollment_agreement_signed;

    const updated = await xano.familyPayments.update(existing.id, updateData);
    return NextResponse.json(updated);
  }

  // Create new — payload only carries columns that still exist on
  // the live Xano schema. `registration_fee_waiver_id` and the
  // `tuition_reviewed` triplet (`tuition_reviewed`,
  // `tuition_reviewed_at`, `tuition_reviewed_by`) were retired
  // from the table; sending them caused Xano to reject the create
  // on unknown columns, which silently no-op'd the upsert.
  const payment = await xano.familyPayments.create({
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    isFamilyAccepted: body.isFamilyAccepted ?? false,
    signature: body.signature ?? {},
    name: body.name ?? "",
    signature_data: body.signature_data ?? null,
    enrollment_agreement_pandadoc_id: body.enrollment_agreement_pandadoc_id ?? "",
    enrollment_agreement_status: body.enrollment_agreement_status ?? "",
    enrollment_agreement_sent_at: body.enrollment_agreement_sent_at ?? null,
    enrollment_agreement_pdf_url: "",
    is_enrollment_agreement_signed: body.is_enrollment_agreement_signed ?? false,
  });

  return NextResponse.json(payment);
}
