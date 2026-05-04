import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudentRegistration } from "@/lib/xano";

/**
 * Admin-only PATCH for one `registration_student_registration` packet.
 *
 * Distinct from the parent-side `/api/student-registration/[id]`
 * route: that one requires a parent Clerk session and is scoped to
 * the parent's own family — it can't flip the admin-only
 * `registrationConfirmed` flag (the parent dashboard reads this to
 * decide whether to render the enrolled view, so letting parents
 * flip it themselves would be a self-serve enrollment loophole).
 *
 * The admin route's primary use case is toggling
 * `registrationConfirmed` from the family registration detail page,
 * but the allowlist also covers the liability-waiver metadata so
 * an admin can mirror PandaDoc state back onto the row when
 * something goes sideways with the webhook.
 *
 * URL: `/api/admin/student-registration/[id]` where `[id]` is the
 *   packet's primary key.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid packet id" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Tight allowlist — admin can flip the confirm flag and patch the
    // liability-waiver state, nothing else. Editing the rest of the
    // packet (medical info, file uploads, etc.) belongs on the
    // parent-side flow — those are facts the family records, not
    // admin overrides.
    const ALLOWED: Array<keyof XanoStudentRegistration> = [
      "registrationConfirmed",
      "liability_waiver_pandadoc_id",
      "liability_waiver_status",
      "liability_waiver_sent_at",
      "liability_waiver_pdf_url",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.studentRegistration.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}
