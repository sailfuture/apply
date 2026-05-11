import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin POST — create a `registration_emergency_contacts` row for
 * any family. Distinct from the parent-side `/api/emergency-contacts`
 * which is scoped to the authenticated parent's own family; this
 * route lets admin add a contact on behalf of any family from the
 * registration detail page.
 *
 * Body:
 *   - `familyId` (required) — which family the contact attaches to
 *   - `first_name`, `last_name`, `email`, `phone`, `relationship`,
 *     `address_line_1`, `address_line_2`, `city`, `state`, `zipcode`
 *     (all optional; empty string default for missing fields so the
 *     parent-side editor can later fill them in)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const familyId = Number(body?.familyId);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    const contact = await xano.emergencyContacts.create({
      registration_families_id: familyId,
      first_name: typeof body?.first_name === "string" ? body.first_name : "",
      last_name: typeof body?.last_name === "string" ? body.last_name : "",
      email: typeof body?.email === "string" ? body.email : "",
      phone: typeof body?.phone === "string" ? body.phone : "",
      relationship:
        typeof body?.relationship === "string" ? body.relationship : "",
      address_line_1:
        typeof body?.address_line_1 === "string" ? body.address_line_1 : "",
      address_line_2:
        typeof body?.address_line_2 === "string" ? body.address_line_2 : "",
      city: typeof body?.city === "string" ? body.city : "",
      state: typeof body?.state === "string" ? body.state : "",
      zipcode: typeof body?.zipcode === "string" ? body.zipcode : "",
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}
