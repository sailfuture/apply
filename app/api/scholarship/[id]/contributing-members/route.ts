import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const members = await xano.scholarshipContributingMembers.getByScholarshipId(Number(id));
  return NextResponse.json(members);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const scholarshipId = Number(id);
  // Reject silently-invalid scholarship ids up front. Without this
  // guard, `Number("abc") = NaN` would land at Xano as
  // `registration_opportunity_scholarship_id: NaN` and the row, even
  // if it created, would be unfindable by the page's per-scholarship
  // filter. Better to fail loudly here.
  if (!Number.isFinite(scholarshipId) || scholarshipId <= 0) {
    return NextResponse.json(
      { error: "Invalid scholarship id" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  // Try/catch around the Xano call so a backend rejection (schema
  // mismatch, required-field add, etc.) returns a real JSON error to
  // the client instead of bubbling an uncaught throw → 500. The
  // parent-side `addMember` previously swallowed non-OK responses
  // silently; now both the network status code AND the body carry
  // the real error so the page can surface it in a toast.
  try {
    const member = await xano.scholarshipContributingMembers.create({
      registration_opportunity_scholarship_id: scholarshipId,
      first_name: body.first_name ?? "",
      last_name: body.last_name ?? "",
      address_1: body.address_1 ?? "",
      address_2: body.address_2 ?? "",
      city: body.city ?? "",
      state: body.state ?? "",
      zipcode: body.zipcode ?? "",
      estimated_annual_income: body.estimated_annual_income ?? 0,
      isW2: body.isW2 ?? false,
      isPayStubs: body.isPayStubs ?? false,
      // Each verification slot is now a multi-file array. Default to []
      // on create so the new member shows up with editable empty uploads
      // instead of nullable single-object fields.
      w2: [],
      paystub_1: [],
      paystub_2: [],
      paystub_3: [],
      paystub_4: [],
    });

    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed";
    console.error(
      "[/api/scholarship/[id]/contributing-members] create failed:",
      err
    );
    return NextResponse.json(
      { error: `Couldn't create contributing member: ${message}` },
      { status: 502 }
    );
  }
}
