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
  // Return the WRAPPED shape the parent Financial Aid edit page expects:
  // `{ opportunity_scholarship, homes, vehicles, contributing_members,
  // benefits }`. `getById` unwraps to the flat scholarship row (no child
  // arrays + no `opportunity_scholarship` key), which made the edit
  // page's hydrate guard bail and render an EMPTY form — parents then
  // re-entered everything and resubmitted, creating duplicate child rows
  // (contributing members, etc.). `getByIdWithChildren` returns the
  // normalized children in one round trip.
  const full = await xano.scholarship.getByIdWithChildren(Number(id));
  return NextResponse.json({
    opportunity_scholarship: full.scholarship,
    homes: full.homes,
    vehicles: full.vehicles,
    contributing_members: full.contributing_members,
    benefits: full.benefits,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updated = await xano.scholarship.update(Number(id), body);
  return NextResponse.json(updated);
}
