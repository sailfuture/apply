import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Shared auth gate for the Vercel Cron routes. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when the env var is set.
 *
 * Fails CLOSED: in production a missing `CRON_SECRET` returns 503
 * instead of leaving the endpoint world-callable — these routes
 * mutate data (SMS imports, reminder sends, calendar writes) and one
 * of them returns real phone numbers, so a dropped env var must be a
 * loud outage, not a silent open door. Local dev (NODE_ENV !==
 * "production") stays open for manual spot-checks, which is the only
 * legitimate use the old fail-open behavior served.
 *
 * Returns null when the request is authorized; otherwise the
 * NextResponse to return.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return null;
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run in production."
    );
    return NextResponse.json(
      { error: "Cron auth is not configured" },
      { status: 503 }
    );
  }
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const ok =
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
