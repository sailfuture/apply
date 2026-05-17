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
  // `billing_start_date` is an ISO `YYYY-MM-DD` string — Stripe's
  // billing anchor for every Subscription tied to this year.
  "billing_start_date",
];

const BOOL_FIELDS: (keyof XanoSchoolYear)[] = [
  "isActive",
  "isPast",
  "isNextYear",
  "isFuture",
];

// Nullable-number fields — distinct from `NUMERIC_FIELDS` above because
// these accept `null` (the "closed" state) instead of coercing to 0.
// `reapplications_opened_at` is the timestamp admin stamps when opening
// re-applications for a year; setting back to null closes them.
const NULLABLE_NUMBER_FIELDS: (keyof XanoSchoolYear)[] = [
  "reapplications_opened_at",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const row = await xano.schoolYears.getById(id);
    return NextResponse.json(row);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of STRING_FIELDS) {
      if (f in body) {
        const v = body[f];
        patch[f] = typeof v === "string" ? v : v == null ? null : String(v);
      }
    }
    for (const f of NUMERIC_FIELDS) {
      if (f in body) {
        const v = Number(body[f]);
        patch[f] = Number.isFinite(v) ? v : 0;
      }
    }
    for (const f of BOOL_FIELDS) {
      if (f in body) patch[f] = body[f] === true;
    }
    for (const f of NULLABLE_NUMBER_FIELDS) {
      if (f in body) {
        const v = body[f];
        if (v == null) {
          patch[f] = null;
        } else {
          const n = Number(v);
          patch[f] = Number.isFinite(n) ? n : null;
        }
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    const updated = await xano.schoolYears.update(id, patch);
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
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await xano.schoolYears.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}
