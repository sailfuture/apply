import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * One device in the laptop inventory.
 *
 *   PATCH — edit device fields. Accepts any subset of:
 *     asset_number / serial_number / model / year_purchase /
 *     device_management_url (strings), rfid_uid (string[]; replaces
 *     the whole list and stamps rfid_assigned_at), deactivated
 *     (boolean → isArchived) + reason_for_archive.
 *   DELETE — remove the device AND its assignment rows (Xano CRUD
 *     deletes don't cascade; orphaned assignments would linger in
 *     the staff scanner's queries otherwise).
 *
 * The ops group's PATCH writes empty values through (verified live),
 * so clearing the RFID list / reactivating a device works without
 * sentinels.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await deviceId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const key of [
      "asset_number",
      "serial_number",
      "model",
      "year_purchase",
      "device_management_url",
      "reason_for_archive",
    ] as const) {
      if (typeof b[key] === "string") patch[key] = (b[key] as string).trim();
    }
    // Renaming asset/serial to empty would break the identity the
    // whole page keys on — treat as a validation error, not a clear.
    if (patch.asset_number === "" || patch.serial_number === "") {
      return NextResponse.json(
        { error: "Asset number and serial number can't be empty" },
        { status: 400 }
      );
    }
    if (patch.model === "") {
      return NextResponse.json(
        { error: "Model can't be empty" },
        { status: 400 }
      );
    }
    if (Array.isArray(b.rfid_uid)) {
      // Replace-the-list semantics; dedupe + drop blanks so a double
      // scan can't store the same tag twice.
      const uids = [
        ...new Set(
          b.rfid_uid
            .filter((u): u is string => typeof u === "string")
            .map((u) => u.trim().toUpperCase())
            .filter(Boolean)
        ),
      ];
      patch.rfid_uid = uids;
      patch.rfid_assigned_at = Date.now();
    }
    if (typeof b.deactivated === "boolean") {
      patch.isArchived = b.deactivated;
      // Reactivating clears the archive reason unless the caller
      // explicitly sent one.
      if (!b.deactivated && typeof b.reason_for_archive !== "string") {
        patch.reason_for_archive = "";
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.laptops.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await deviceId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    // Take the assignment rows down with the device — sequential so a
    // failure leaves the device (and the retry path) intact.
    const assignments = await xano.laptopAssignments.getAll();
    for (const a of assignments) {
      if (Number(a.laptops_id) === id) {
        await xano.laptopAssignments.remove(a.id);
      }
    }
    await xano.laptops.remove(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function deviceId(
  params: Promise<{ id: string }>
): Promise<number | null> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  return Number.isFinite(id) && id > 0 ? id : null;
}
