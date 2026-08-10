import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { withStripePrices } from "@/lib/store-server";

/**
 * Parent-facing store catalog — active items only, in sort order.
 * Prices come from Stripe (the Payment Link's real amount) via
 * `withStripePrices`; the stored `price_cents` is only the fallback
 * cache. Returns [] when the `store_items` table isn't
 * reachable so the dashboard's Store section simply hides instead of
 * erroring.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const items = await withStripePrices(await xano.storeItems.getAll());
    const active = items
      .filter((i) => i.is_active === true)
      .sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
      )
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description ?? "",
        price_cents: i.price_cents ?? 0,
        payment_link_url: i.payment_link_url,
        image_url: i.image_url,
      }));
    return NextResponse.json(active, { status: 200 });
  } catch (err) {
    console.error("[/api/store/items] catalog lookup failed:", err);
    return NextResponse.json([], { status: 200 });
  }
}
