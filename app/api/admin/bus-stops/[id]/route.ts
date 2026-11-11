import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { moveRidersBetweenStops, parseStopBody } from "@/lib/bus-stops";

/**
 * Edit one catalog bus stop.
 *
 *   PATCH /api/admin/bus-stops/:id
 *   body: any of { name, address, pick_up_time, drop_off_time }
 *
 * Times use the column's H*100+MM clock encoding (810 = 8:10 AM).
 * Applications reference stops by NAME (the snapshot on the bus
 * election), so a rename rewrites that name on every application
 * that carried the old one — otherwise the stop's riders would fall
 * out into a second, unmatched card on the rosters.
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
    let priorName = "";
    if (parsed.name) {
      const existing = await xano.busStops.getAll().catch(() => []);
      priorName = (
        existing.find((s) => s.id === stopId)?.name ?? ""
      ).trim();
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
    // Rename → carry the riders along. The stop itself is already
    // saved, so a partial failure is reported rather than thrown: the
    // leftover riders show as their own card with a Move riders button.
    let ridersMoved = 0;
    let ridersFailed = 0;
    if (parsed.name && priorName && priorName !== parsed.name) {
      try {
        const r = await moveRidersBetweenStops({
          from: priorName,
          to: parsed.name,
        });
        ridersMoved = r.moved;
        ridersFailed = r.failed;
      } catch (err) {
        console.error(
          `[/api/admin/bus-stops/${stopId}] rider rename cascade failed:`,
          err
        );
        ridersFailed = -1;
      }
    }
    return NextResponse.json({ ok: true, stop, ridersMoved, ridersFailed });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Remove one stop from the catalog.
 *
 *   DELETE /api/admin/bus-stops/:id
 *
 * Only the catalog row goes: parents can no longer pick the stop.
 * Applications reference stops by NAME, so riders still assigned to
 * it are not changed — the roster lists them under the old name as
 * an unmatched card with a Move riders button, the same as any other
 * name that isn't in the catalog.
 */
export async function DELETE(
  _req: NextRequest,
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
    // Read first so a stale card (already deleted in another tab)
    // answers 404 instead of a raw Xano error.
    const existing = await xano.busStops.getAll();
    const stop = existing.find((s) => s.id === stopId);
    if (!stop) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }
    await xano.busStops.delete(stopId);
    return NextResponse.json({ ok: true, name: (stop.name ?? "").trim() });
  } catch (err) {
    return handleAdminError(err);
  }
}
