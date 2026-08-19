import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { parseStopBody } from "@/lib/bus-stops";

/**
 * Edit one catalog bus stop.
 *
 *   PATCH /api/admin/bus-stops/:id
 *   body: any of { name, address, pick_up_time, drop_off_time }
 *
 * Times use the column's H*100+MM clock encoding (810 = 8:10 AM).
 * NOTE: applications reference stops by NAME (the snapshot on the
 * bus election), so renaming a stop moves its existing riders into
 * the orphaned-name group on the rosters until their elections are
 * updated — the UI warns before a rename.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const stopId = Number(id);
    if (!Number.isFinite(stopId) || stopId <= 0) {
      return NextResponse.json(
        { error: "Invalid stop id" },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = parseStopBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 }
      );
    }
    // Renaming onto another stop's name would collide in the
    // name-keyed roster (hidden row) and duplicate the parent
    // picker — same guard as create, excluding this row itself.
    if (parsed.name) {
      const existing = await xano.busStops.getAll().catch(() => []);
      const nameKey = parsed.name.toLowerCase();
      if (
        existing.some(
          (s) =>
            s.id !== stopId &&
            (s.name ?? "").trim().toLowerCase() === nameKey
        )
      ) {
        return NextResponse.json(
          { error: `A stop named "${parsed.name}" already exists.` },
          { status: 400 }
        );
      }
    }
    const stop = await xano.busStops.update(stopId, parsed);
    return NextResponse.json({ ok: true, stop });
  } catch (err) {
    return handleAdminError(err);
  }
}
