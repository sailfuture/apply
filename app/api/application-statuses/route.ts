import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statuses = await xano.applicationStatuses.getAll();
  return NextResponse.json(statuses, { status: 200 });
}
