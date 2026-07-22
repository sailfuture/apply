import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";

/**
 * Google Places autocomplete proxy for the event Location field.
 *
 *   GET /api/admin/places?q=<text>&session=<uuid>
 *     → { configured, suggestions: [{ main, secondary, full }] }
 *
 * Proxies Places API (New) `places:autocomplete` with the server-side
 * GOOGLE_MAPS_API_KEY so the key never reaches the browser. The
 * optional session token groups one typing session for Google's
 * per-session billing. Missing key or upstream failure degrades to an
 * empty list (`configured: false` tells the input to stop asking) —
 * the Location field keeps working as plain text either way.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const session = req.nextUrl.searchParams.get("session") ?? "";
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      return NextResponse.json({ configured: false, suggestions: [] });
    }
    if (q.length < 3) {
      return NextResponse.json({ configured: true, suggestions: [] });
    }

    const upstream = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
        },
        body: JSON.stringify({
          input: q,
          ...(session ? { sessionToken: session } : {}),
          includedRegionCodes: ["us"],
        }),
        cache: "no-store",
      }
    );
    if (!upstream.ok) {
      console.error(
        "[/api/admin/places] upstream error:",
        upstream.status,
        await upstream.text().catch(() => "")
      );
      return NextResponse.json({ configured: true, suggestions: [] });
    }

    type Prediction = {
      placePrediction?: {
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    };
    const data = await upstream.json();
    const suggestions = ((data?.suggestions ?? []) as Prediction[])
      .map((s) => {
        const p = s.placePrediction;
        if (!p) return null; // skip queryPrediction rows
        const full = p.text?.text ?? "";
        if (!full) return null;
        return {
          main: p.structuredFormat?.mainText?.text ?? full,
          secondary: p.structuredFormat?.secondaryText?.text ?? "",
          full,
        };
      })
      .filter(Boolean)
      .slice(0, 6);
    return NextResponse.json({ configured: true, suggestions });
  } catch (err) {
    return handleAdminError(err);
  }
}
