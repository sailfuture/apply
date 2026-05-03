import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Returns the current Clerk user's `registration_parents` row, or null.
 * Used by the welcome page to pre-fill the primary parent's first / last
 * name from the record the Clerk webhook seeded on signup. Returning
 * `null` (not 404) when the row doesn't exist yet keeps the welcome flow
 * graceful — the form just renders with empty inputs.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json(null, { status: 200 });
  const user = await currentUser();
  if (!user) return NextResponse.json(null, { status: 200 });
  const parent = await xano.parents.findByClerkId(userId);
  return NextResponse.json(parent ?? null);
}
