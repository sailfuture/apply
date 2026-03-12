import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const busStops = await xano.busStops.getAll();
    return NextResponse.json(busStops);
  } catch (err) {
    console.error("Failed to fetch bus stops:", err);
    return NextResponse.json([], { status: 200 });
  }
}
