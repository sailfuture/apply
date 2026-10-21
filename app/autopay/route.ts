import { NextRequest, NextResponse } from "next/server";

/**
 * Short autopay link for billing SMS:
 *
 *   GET /autopay  →  302 to /dashboard/tuition#autopay
 *
 * Sign-in gated like the rest of the app (deliberately not in
 * proxy.ts's public list): Clerk sends a signed-out parent to sign in
 * and back to /autopay, and the fragment survives this second hop
 * where it wouldn't survive the sign-in round trip. The Tuition page
 * scrolls its Autopay panel into view for `#autopay`.
 */

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/dashboard/tuition#autopay", req.url), 302);
}
