import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoSchoolYear } from "@/lib/xano";

const NUMERIC_FIELDS: (keyof XanoSchoolYear)[] = [
  "tuition",
  "annual_fees",
  "transportation_fees",
  "fes_eo_8",
  "fes_eo_9",
  "ftc_8",
  "ftc_9",
  "fes_ua_8_ese_1_3",
  "fes_ua_9_ese_1_3",
  "fes_ua_ese_4",
  "fes_ua_ese_5",
  "opportunity_scholarship_award",
];

const STRING_FIELDS: (keyof XanoSchoolYear)[] = [
  "year_name",
  "start_date",
  "end_date",
  "application_deadline",
  "opportunity_scholarship_deadline",
];

const BOOL_FIELDS: (keyof XanoSchoolYear)[] = [
  "isActive",
  "isPast",
  "isNextYear",
  "isFuture",
];

/**
 * Build a Xano-shaped school-year payload from a request body. Coerces
 * each field to its expected type, defaults missing fields, and silently
 * drops anything not in the allowlists. Used by both POST (with full
 * defaults) and PATCH (with `partial=true` to skip defaults so we only
 * send fields the admin actually changed).
 */
function buildPayload(
  body: Record<string, unknown>,
  partial: boolean
): Partial<Omit<XanoSchoolYear, "id" | "created_at">> {
  const out: Record<string, unknown> = {};
  for (const f of STRING_FIELDS) {
    if (f in body) {
      const v = body[f];
      out[f] = typeof v === "string" ? v : v == null ? null : String(v);
    } else if (!partial) {
      out[f] = null;
    }
  }
  for (const f of NUMERIC_FIELDS) {
    if (f in body) {
      const v = Number(body[f]);
      out[f] = Number.isFinite(v) ? v : 0;
    } else if (!partial) {
      out[f] = 0;
    }
  }
  for (const f of BOOL_FIELDS) {
    if (f in body) {
      out[f] = body[f] === true;
    } else if (!partial) {
      out[f] = false;
    }
  }
  return out as Partial<Omit<XanoSchoolYear, "id" | "created_at">>;
}

export async function GET() {
  try {
    await requireAdmin();
    const years = await xano.schoolYears.getAll();
    // Sort: upcoming → active → future → past, newer year_name first
    // within each bucket. Same convention used by the admin year selector.
    const rank = (y: XanoSchoolYear) => {
      if (y.isNextYear) return 0;
      if (y.isActive) return 1;
      if (y.isFuture) return 2;
      return 3;
    };
    const sorted = [...years].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return (b.year_name ?? "").localeCompare(a.year_name ?? "");
    });
    return NextResponse.json(sorted);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    if (!body?.year_name || typeof body.year_name !== "string") {
      return NextResponse.json(
        { error: "year_name is required" },
        { status: 400 }
      );
    }
    const payload = buildPayload(body, false) as Omit<
      XanoSchoolYear,
      "id" | "created_at"
    >;
    const created = await xano.schoolYears.create(payload);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}
