import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoEmergencyContact } from "@/lib/xano";

/**
 * Admin-only PATCH for a single `registration_emergency_contacts`
 * row. Used by the inline edit affordance on the family registration
 * detail page — admin clicks the pencil next to a contact, edits
 * fields, saves.
 *
 * Allowlist mirrors the create POST in the parent route. Foreign
 * keys (`registration_families_id`) and `id` / `created_at` are
 * deliberately excluded — re-parenting a contact between families
 * isn't a workflow admin needs.
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
        { error: "Invalid emergency contact id" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const ALLOWED: Array<keyof XanoEmergencyContact> = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "relationship",
      "address_line_1",
      "address_line_2",
      "city",
      "state",
      "zipcode",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) {
        patch[key] = typeof body[key] === "string" ? body[key] : "";
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    const updated = await xano.emergencyContacts.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Admin-only hard DELETE for a single `registration_emergency_contacts`
 * row. Backs the trash affordance next to the pencil on the family
 * registration detail page — admin removes a contact a family no
 * longer wants on file.
 *
 * Hard delete (not a soft flag): emergency contacts are standalone
 * rows with no downstream dependents, so there's nothing to orphan.
 * The parent flow can always re-add one.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid emergency contact id" },
        { status: 400 }
      );
    }
    await xano.emergencyContacts.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}
