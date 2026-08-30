import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Machine-to-machine endpoints that authenticate themselves and can't
  // present a Clerk session: inbound webhooks (Twilio/Stripe signature
  // checks) and Vercel Cron (its own `CRON_SECRET` bearer). Without this
  // exemption the blanket `/api/*` 401 below blocks the cron before its
  // own auth runs, so the reminder sweep never executes in production.
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  // Public iCalendar feed — Google/Apple Calendar subscribe to it and
  // can't present a Clerk session; the route guards itself with the
  // CALENDAR_FEED_TOKEN query secret (404 without it).
  "/api/calendar-feed(.*)",
  // Short pay links from billing SMS — a parent tapping the text is
  // rarely signed in, and the destination (Stripe's hosted invoice
  // page) is unauthenticated by design. Keyed by unguessable Stripe
  // invoice ids; unknown ids bounce to the sign-in-gated tuition page.
  "/pay(.*)",
  // Legal + SMS-compliance pages. Linked from the SMS opt-in block and
  // referenced by the Twilio A2P campaign registration, whose reviewers
  // (and parents reading a text's fine print) have no Clerk session —
  // these must resolve publicly or campaign vetting fails.
  "/terms",
  "/privacy",
  "/sms-opt-in",
]);

/**
 * `/api/*` routes need different auth-failure handling than page
 * routes. For pages, `auth.protect()` redirects unauthenticated
 * users to `/sign-in` — exactly what we want. For API routes,
 * `auth.protect()`'s built-in behavior is "hide that the route
 * exists" — it responds with **404**, not 401. That was surfacing
 * in production as `Failed to load resource: 404` on
 * `/api/families` / `/api/school-years` during the brief window
 * after sign-in where SWR fetches fire before the new session
 * cookie has propagated into the next request context. SWR's
 * retry-on-error logic can't reason about 404 (it normally means
 * "the route doesn't exist, retrying won't help"), so the errors
 * lingered visibly in the console.
 *
 * Fix: keep middleware-level auth as a backstop for API routes
 * (defense-in-depth — if a route forgets to call `auth()` itself,
 * the middleware still blocks unauthenticated callers), but issue
 * a semantic 401 instead of 404 so SWR retries cleanly and the
 * console error reads correctly.
 */
const isApiRoute = createRouteMatcher(["/api/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  if (isApiRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    return;
  }

  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
