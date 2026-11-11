import { xano } from "@/lib/xano";

/**
 * Shared validation for the bus-stop create/edit routes (a route file
 * can only export handlers, so this lives here). Times must be valid
 * H*100+MM 24-hour clock numbers — the `registration_bus` column's
 * encoding (810 = 8:10 AM, 1445 = 2:45 PM; 0 = unset). Only fields
 * present in the body come back, so PATCH stays partial.
 */
export function parseStopBody(body: unknown):
  | {
      name?: string;
      address?: string;
      pick_up_time?: number;
      drop_off_time?: number;
    }
  | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;
  const out: {
    name?: string;
    address?: string;
    pick_up_time?: number;
    drop_off_time?: number;
  } = {};
  if ("name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { error: "name can't be empty" };
    out.name = name;
  }
  if ("address" in b) {
    out.address = typeof b.address === "string" ? b.address.trim() : "";
  }
  for (const key of ["pick_up_time", "drop_off_time"] as const) {
    if (!(key in b)) continue;
    const v = Number(b[key]);
    const valid =
      Number.isInteger(v) &&
      v >= 0 &&
      Math.floor(v / 100) <= 23 &&
      v % 100 <= 59;
    if (!valid) {
      return {
        error: `${key} must be a 24-hour clock number like 810 (8:10 AM) or 1445 (2:45 PM)`,
      };
    }
    out[key] = v;
  }
  return out;
}

/** Roster label for riders who elected the bus but picked no stop. */
export const NO_STOP_LABEL = "No stop selected";

/**
 * Re-point riders from one stop NAME to another. Applications snapshot
 * the stop by name, so this is what keeps a roster whole when a stop
 * is renamed (every year's rows follow the new name) or when riders
 * stranded under an old name are moved onto a catalog stop (one year).
 *
 * `from` may be NO_STOP_LABEL — that matches bus riders with an empty
 * stop. Returns how many rows were rewritten and how many failed, so
 * the caller can tell the admin when some riders didn't move.
 */
export async function moveRidersBetweenStops(opts: {
  from: string;
  to: string;
  /** Limit to one school year; omit to rewrite every year's rows. */
  yearId?: number;
}): Promise<{ moved: number; failed: number }> {
  const from = opts.from.trim();
  const to = opts.to.trim();
  if (!to || from === to) return { moved: 0, failed: 0 };
  const apps = await xano.applications.getAll();
  const targets = apps.filter((a) => {
    if (
      opts.yearId != null &&
      Number(a.registration_school_years_id) !== opts.yearId
    ) {
      return false;
    }
    const stop = (a.bus_stop ?? "").trim();
    if (from === NO_STOP_LABEL) {
      return a.is_bus_transportation === true && !stop;
    }
    return stop === from;
  });
  let moved = 0;
  let failed = 0;
  // Small batches — the shared Xano instance stalls under bursts.
  for (let i = 0; i < targets.length; i += 4) {
    const results = await Promise.allSettled(
      targets
        .slice(i, i + 4)
        .map((a) => xano.applications.update(a.id, { bus_stop: to }))
    );
    for (const r of results) {
      if (r.status === "fulfilled") moved += 1;
      else {
        failed += 1;
        console.error("[bus-stops] rider move failed:", r.reason);
      }
    }
  }
  return { moved, failed };
}
