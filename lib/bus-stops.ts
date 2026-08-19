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
