import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "twilio";
import { getTwilioAuthToken } from "@/lib/twilio";

/**
 * Parse a Twilio webhook (always form-encoded) and verify its
 * signature. Returns the params, or the response to send instead.
 *
 * Fails CLOSED outside local dev: with the auth token unset, a webhook
 * would accept forged inbound texts, opt-outs, statuses and calls from
 * anyone — so a missing token is a loud 503 (Twilio's error alerting
 * picks it up), never a silent unverified request. Local dev stays
 * open so the routes can be exercised without real credentials.
 *
 * `path` is the route's public path: Twilio signs the URL it was
 * configured with, and proxies rewrite host/proto, so the configured
 * app URL is preferred over the request's own.
 */
export async function readTwilioWebhook(
  req: NextRequest,
  path: string
): Promise<
  | { ok: true; params: Record<string, string> }
  | { ok: false; response: NextResponse }
> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // A malformed probe gets a 400, not an unhandled 500 (which
    // Twilio-side would read as retryable).
    return {
      ok: false,
      response: new NextResponse("Expected form-encoded body", { status: 400 }),
    };
  }
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    params[k] = typeof v === "string" ? v : "";
  }

  const authToken = getTwilioAuthToken();
  if (authToken) {
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const base = process.env.NEXT_PUBLIC_APP_URL;
    const url = base ? `${base.replace(/\/$/, "")}${path}` : req.nextUrl.href;
    if (!validateRequest(authToken, signature, url, params)) {
      return {
        ok: false,
        response: new NextResponse("Invalid Twilio signature", { status: 403 }),
      };
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error(
      `[twilio webhook ${path}] TWILIO_AUTH_TOKEN is not set — rejecting unverifiable webhook.`
    );
    return {
      ok: false,
      response: new NextResponse("Webhook auth is not configured", {
        status: 503,
      }),
    };
  }
  return { ok: true, params };
}

/** A TwiML response body, 200. */
export function twiml(inner = ""): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
