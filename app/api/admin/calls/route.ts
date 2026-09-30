import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoCall } from "@/lib/xano";

/**
 * A contact's phone calls on the Main Line, oldest first — for the
 * lead timeline and the family activity log.
 *
 *   GET /api/admin/calls?contactType=inquiry&contactId=184
 */
export const dynamic = "force-dynamic";

const TYPES = new Set(["family", "inquiry", "camp", "visit", "tasco"]);

export interface CallsResponse {
  calls: XanoCall[];
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const type = req.nextUrl.searchParams.get("contactType") ?? "";
    const id = Number(req.nextUrl.searchParams.get("contactId"));
    if (!TYPES.has(type) || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "contactType and contactId are required" }, { status: 400 });
    }
    const calls = await xano.calls.getByContact(
      type as "family" | "inquiry" | "camp" | "visit" | "tasco",
      id
    );
    return NextResponse.json({ calls } satisfies CallsResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}
