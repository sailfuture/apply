import { getStripeClient } from "@/lib/stripe";
import { xano } from "@/lib/xano";
import type { XanoStoreItem } from "@/lib/xano";

/**
 * Server-side store pricing — Stripe is the single source of truth.
 *
 * Each catalog item's displayed price is resolved from its Payment
 * Link's line items (unit amount × quantity per checkout). The
 * `price_cents` column on `registration_store_items` is only a cache:
 * whenever the resolved price differs, we write it back (best-effort)
 * so the stored value tracks Stripe and keeps working as a fallback
 * when Stripe is unreachable.
 *
 * Kept out of lib/store.ts because that module is imported by client
 * components and must not pull in the Stripe SDK.
 */

/** url → cents, cached for a few minutes so dashboard loads don't
 *  hit Stripe every time. Module-level: per serverless instance. */
let priceCache: { at: number; byUrl: Map<string, number> } | null = null;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve live prices for the given items and sync the `price_cents`
 * cache column. Returns the items with `price_cents` replaced by the
 * Stripe price wherever one resolved (stored value kept otherwise).
 */
export async function withStripePrices(
  items: XanoStoreItem[]
): Promise<XanoStoreItem[]> {
  if (items.length === 0) return items;
  const byUrl = await getPricesByUrl();
  if (!byUrl) return items;

  return items.map((item) => {
    const fresh = byUrl.get(item.payment_link_url);
    if (fresh == null || fresh === item.price_cents) return item;
    // Sync the cache column — best-effort, never blocks the response.
    void xano.storeItems
      .update(item.id, { price_cents: fresh })
      .catch((err) =>
        console.error(
          `[store-server] failed to sync price for item ${item.id}:`,
          err
        )
      );
    return { ...item, price_cents: fresh };
  });
}

/** url → cents for every Payment Link on the account (first 100 —
 *  far above the catalog's size). Null when Stripe is unreachable. */
async function getPricesByUrl(): Promise<Map<string, number> | null> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) {
    return priceCache.byUrl;
  }
  try {
    const stripe = getStripeClient();
    const links = await stripe.paymentLinks.list({ limit: 100 });
    const byUrl = new Map<string, number>();
    await Promise.all(
      links.data.map(async (link) => {
        try {
          const lineItems = await stripe.paymentLinks.listLineItems(link.id, {
            limit: 10,
          });
          const cents = lineItems.data.reduce(
            (sum, li) =>
              sum + (li.price?.unit_amount ?? 0) * (li.quantity ?? 1),
            0
          );
          if (cents > 0) byUrl.set(link.url, cents);
        } catch (err) {
          console.error(
            `[store-server] failed to price payment link ${link.id}:`,
            err
          );
        }
      })
    );
    priceCache = { at: Date.now(), byUrl };
    return byUrl;
  } catch (err) {
    console.error("[store-server] failed to list payment links:", err);
    return null;
  }
}
