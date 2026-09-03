import { getFamilyAuth } from "@/lib/family-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * The authenticated family's own store purchases, newest first.
 * Sanitized — Stripe ids stay server-side. Returns [] when the
 * `store_orders` table isn't reachable so the parent Store section
 * degrades to catalog-only.
 */
export async function GET() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const orders = await xano.storeOrders.getAll();
    const own = orders
      .filter((o) => Number(o.registration_families_id) === familyId)
      .sort((a, b) => (Number(b.paid_at) || 0) - (Number(a.paid_at) || 0))
      .map((o) => ({
        id: o.id,
        item: o.item,
        quantity: o.quantity,
        total_amount_cents: o.total_amount_cents,
        size: (o.size ?? "").trim(),
        student_name: (o.student_name ?? "").trim(),
        paid_at: Number(o.paid_at) || 0,
        distributed: o.distributed === true,
        distributed_at: o.distributed_at ?? null,
      }));
    return NextResponse.json(own, { status: 200 });
  } catch (err) {
    console.error("[/api/store/orders] order lookup failed:", err);
    return NextResponse.json([], { status: 200 });
  }
}
