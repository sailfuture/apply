import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStoreOrder } from "@/lib/xano";

/**
 * Every store purchase, newest first, with the family display name
 * joined in ("Unattributed" for purchases made through a bare link
 * with no family reference).
 */
export async function GET() {
  try {
    await requireAdmin();
    const [orders, families] = await Promise.all([
      xano.storeOrders.getAll(),
      xano.families.getAll(),
    ]);
    const nameById = new Map(
      families.map((f) => [Number(f.id), f.family_name ?? ""])
    );
    const rows: AdminStoreOrderRow[] = orders
      .sort((a, b) => (Number(b.paid_at) || 0) - (Number(a.paid_at) || 0))
      .map((o) => ({
        ...o,
        family_name:
          nameById.get(Number(o.registration_families_id)) || "Unattributed",
      }));
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export type AdminStoreOrderRow = XanoStoreOrder & { family_name: string };
