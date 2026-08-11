import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { loadEventItems } from "@/lib/school-event-items";
import { xano } from "@/lib/xano";

/**
 * One event's needs list, plus how much of each families have claimed.
 *
 * The event editor fetches this itself rather than taking it as a prop.
 * The editor always submits the COMPLETE list on save (that's how
 * deletes are expressed), so a caller that forgot to pass the current
 * items would silently wipe them — making the dialog responsible for
 * its own data removes that footgun entirely.
 *
 * `claimed` is read-only context for admin: it's why a need can't
 * simply be deleted without thought once families have committed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    }

    const items = await loadEventItems(id);
    // Claims degrade to [] — the counts are decoration on this route,
    // and the editor must still open if the table is unreachable.
    const claims = await xano.eventItemClaims.getAll().catch(() => []);
    const claimedByItem = new Map<number, number>();
    for (const c of claims) {
      const key = Number(c.registration_school_event_items_id);
      claimedByItem.set(
        key,
        (claimedByItem.get(key) ?? 0) + (Number(c.quantity) || 0)
      );
    }

    return NextResponse.json({
      items: items.map((i) => ({
        id: i.id,
        label: i.label,
        quantity: Math.max(1, Number(i.quantity) || 1),
        claimed: claimedByItem.get(i.id) ?? 0,
      })),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
