import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { loadEventItems } from "@/lib/school-event-items";
import { xano } from "@/lib/xano";

/**
 * One event's needs list, plus how much of each families have claimed
 * and which families claimed it.
 *
 * The event editor fetches this itself rather than taking it as a prop.
 * The editor always submits the COMPLETE list on save (that's how
 * deletes are expressed), so a caller that forgot to pass the current
 * items would silently wipe them — making the dialog responsible for
 * its own data removes that footgun entirely.
 *
 * `claimed` and `claims` are read-only context for admin: they're why
 * a need can't simply be deleted without thought once families have
 * committed — and the names say exactly who would be let go.
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
    // Claims and family names degrade to empty — they're decoration on
    // this route, and the editor must still open if either table is
    // unreachable.
    const [claims, families] = await Promise.all([
      xano.eventItemClaims.getAll().catch(() => []),
      xano.families.getAll().catch(() => []),
    ]);
    const familyName = new Map(
      families.map((f) => [f.id, f.family_name?.trim() || `Family #${f.id}`])
    );
    const itemIds = new Set(items.map((i) => i.id));
    const claimsByItem = new Map<
      number,
      Array<{ family_id: number; family_name: string; quantity: number }>
    >();
    for (const c of claims) {
      const key = Number(c.registration_school_event_items_id);
      const quantity = Number(c.quantity) || 0;
      if (!itemIds.has(key) || quantity <= 0) continue;
      const familyId = Number(c.registration_families_id);
      const list = claimsByItem.get(key) ?? [];
      const held = list.find((x) => x.family_id === familyId);
      if (held) held.quantity += quantity;
      else
        list.push({
          family_id: familyId,
          family_name: familyName.get(familyId) ?? `Family #${familyId}`,
          quantity,
        });
      claimsByItem.set(key, list);
    }

    return NextResponse.json({
      items: items.map((i) => {
        const itemClaims = (claimsByItem.get(i.id) ?? []).sort((a, b) =>
          a.family_name.localeCompare(b.family_name)
        );
        return {
          id: i.id,
          label: i.label,
          quantity: Math.max(1, Number(i.quantity) || 1),
          claimed: itemClaims.reduce((s, c) => s + c.quantity, 0),
          claims: itemClaims,
        };
      }),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
