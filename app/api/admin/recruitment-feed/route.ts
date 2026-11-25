import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { RECRUITMENT_APP_URL, type RecruitmentEvent } from "@/lib/lead-events";

/**
 * Every recruitment event, read from the recruitment app
 * (recruitment.sailfutureacademy.org/api/apply/events) — the one place
 * events are kept. Feeds the event combobox on lead sheets and family
 * pages. Server to server with the registration API key, which the
 * recruitment app also holds; cached five minutes.
 */
export async function GET() {
  try {
    await requireAdmin();
    const key = process.env.XANO_API_KEY?.trim();
    if (!key) {
      return NextResponse.json(
        { error: "XANO_API_KEY is not set, so the events can't be read." },
        { status: 503 }
      );
    }
    let res: Response;
    try {
      res = await fetch(`${RECRUITMENT_APP_URL}/api/apply/events`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
        next: { revalidate: 300 },
      });
    } catch (err) {
      console.error("[recruitment-feed] fetch", err);
      return NextResponse.json(
        { error: "The recruitment site didn't answer. Try again." },
        { status: 503 }
      );
    }
    if (!res.ok) {
      console.error("[recruitment-feed] status", res.status);
      return NextResponse.json(
        {
          error:
            res.status === 401
              ? "The recruitment site refused Apply's key."
              : `The recruitment site answered ${res.status}.`,
        },
        { status: 502 }
      );
    }
    const body = (await res.json()) as { events?: RecruitmentEvent[] };
    return NextResponse.json(Array.isArray(body.events) ? body.events : []);
  } catch (err) {
    return handleAdminError(err);
  }
}
