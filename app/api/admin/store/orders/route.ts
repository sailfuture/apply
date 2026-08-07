import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { healStoreOrders } from "@/lib/store-server";
import { xano } from "@/lib/xano";
import type { XanoStoreOrder } from "@/lib/xano";

/**
 * Every store purchase, newest first, with the family display name
 * joined in ("Unattributed" only when the purchaser's email matches
 * no parent on file). `healStoreOrders` runs first — it back-fills
 * family attribution by purchaser email and size/student_name from
 * the Checkout Session's custom fields for rows written before those
 * capture paths existed.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [rawOrders, families] = await Promise.all([
      xano.storeOrders.getAll(),
      xano.families.getAll(),
    ]);
    const orders = await healStoreOrders(rawOrders);
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

    // Family roster for the manual re-attribution picker.
    const familyOptions: StoreFamilyOption[] = families
      .map((f) => ({
        id: Number(f.id),
        name: f.family_name?.trim() || `Family #${f.id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      orders: rows,
      families: familyOptions,
    } satisfies AdminStoreOrdersResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export type AdminStoreOrderRow = XanoStoreOrder & { family_name: string };

export interface StoreFamilyOption {
  id: number;
  name: string;
}

export interface AdminStoreOrdersResponse {
  orders: AdminStoreOrderRow[];
  families: StoreFamilyOption[];
}
