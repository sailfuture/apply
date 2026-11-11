import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { moveRidersBetweenStops } from "@/lib/bus-stops";

/**
 * Move the riders stranded under a stop name that isn't in the catalog
 * (an old name, a deleted stop, or no stop picked) onto a real stop.
 *
 *   POST /api/admin/bus-stops/move
 *   body: { from: string, toStopId: number, yearId: number }
 *
 * Scoped to one school year — the roster the admin is looking at.
 * Refuses when `from` is itself a catalog stop: emptying a live stop
 * is a rename or a per-student change, not a cleanup.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as {
      from?: unknown;
      toStopId?: unknown;
      yearId?: unknown;
    } | null;
    const from = typeof body?.from === "string" ? body.from.trim() : "";
    const toStopId = Number(body?.toStopId);
    const yearId = Number(body?.yearId);
    if (!from || !Number.isFinite(toStopId) || toStopId <= 0) {
      return NextResponse.json(
        { error: "from and toStopId are required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const stops = await xano.busStops.getAll();
    const target = stops.find((s) => s.id === toStopId);
    const to = (target?.name ?? "").trim();
    if (!to) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }
    if (stops.some((s) => (s.name ?? "").trim() === from)) {
      return NextResponse.json(
        { error: `"${from}" is a stop in the list — rename it instead.` },
        { status: 400 }
      );
    }
    const { moved, failed } = await moveRidersBetweenStops({
      from,
      to,
      yearId,
    });
    if (failed > 0) {
      return NextResponse.json(
        {
          error: `${moved} rider${moved === 1 ? "" : "s"} moved, ${failed} failed — try again to move the rest.`,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, moved, to });
  } catch (err) {
    return handleAdminError(err);
  }
}
