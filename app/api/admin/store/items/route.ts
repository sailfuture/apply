import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { parseStoreItemBody } from "@/lib/store";
import { withStripePrices } from "@/lib/store-server";
import { xano } from "@/lib/xano";

/**
 * Admin store catalog — full list (active + hidden) and item create.
 * Prices are resolved from Stripe (single source of truth) — admin
 * never enters one; `price_cents` is just the synced display cache.
 */
export async function GET() {
  try {
    await requireAdmin();
    const items = await withStripePrices(await xano.storeItems.getAll());
    items.sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
    );
    return NextResponse.json(items);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = parseStoreItemBody(body, { requireAll: true });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const created = await xano.storeItems.create({
      name: parsed.name!,
      description: parsed.description ?? "",
      // Filled in from Stripe by the next catalog GET.
      price_cents: 0,
      payment_link_url: parsed.payment_link_url!,
      is_active: parsed.is_active ?? true,
      sort_order: parsed.sort_order ?? 0,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}
