import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schoolYears = await xano.schoolYears.getAll();
  return NextResponse.json(schoolYears, { status: 200 });
}
