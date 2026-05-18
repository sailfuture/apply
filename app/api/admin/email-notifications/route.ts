import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET — returns the email-notification audit log for a single
 * family, optionally filtered to a school year. Backs the "Sent
 * emails" section on the family registration detail page so admin
 * can confirm which transactional emails went out to a family (and
 * which failed).
 *
 * Read-only — writes happen via `lib/emails/send.ts` as a tail-call
 * after every Resend send attempt.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const familyId = Number(familyIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    const yearId = yearIdParam ? Number(yearIdParam) : undefined;
    if (yearIdParam && (!Number.isFinite(yearId) || (yearId ?? 0) <= 0)) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }
    const rows = await xano.emailNotifications.getByFamily(familyId, yearId);
    return NextResponse.json({ rows });
  } catch (err) {
    return handleAdminError(err);
  }
}
