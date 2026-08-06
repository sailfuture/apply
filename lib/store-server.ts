import { getStripeClient } from "@/lib/stripe";
import { xano } from "@/lib/xano";
import type { XanoStoreItem } from "@/lib/xano";

/**
 * Server-side store pricing + product media — Stripe is the single
 * source of truth.
 *
 * Each catalog item's displayed price and product image are resolved
 * from its Payment Link's line items (price × quantity, and the
 * Stripe Product's first image). The `price_cents` column on
 * `registration_store_items` is only a cache: whenever the resolved
 * price differs, we write it back (best-effort) so the stored value
 * tracks Stripe and keeps working as a fallback when Stripe is
 * unreachable. Images aren't persisted — they ride on the response.
 *
 * Kept out of lib/store.ts because that module is imported by client
 * components and must not pull in the Stripe SDK.
 */

export type StoreItemWithStripe = XanoStoreItem & {
  /** Stripe Product image URL ("" when the product has none or
   *  Stripe was unreachable). */
  image_url: string;
};

interface LinkInfo {
  cents: number;
  imageUrl: string;
}

/** url → link info, cached a few minutes so dashboard loads don't
 *  hit Stripe every time. Module-level: per serverless instance. */
let linkCache: { at: number; byUrl: Map<string, LinkInfo> } | null = null;
const LINK_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve live prices + product images for the given items and sync
 * the `price_cents` cache column. Stored price kept where Stripe
 * didn't resolve.
 */
export async function withStripePrices(
  items: XanoStoreItem[]
): Promise<StoreItemWithStripe[]> {
  if (items.length === 0) return [];
  const byUrl = await getLinkInfoByUrl();

  return items.map((item) => {
    const info = byUrl?.get(item.payment_link_url);
    if (!info) return { ...item, image_url: "" };
    if (info.cents > 0 && info.cents !== item.price_cents) {
      // Sync the cache column — best-effort, never blocks the response.
      void xano.storeItems
        .update(item.id, { price_cents: info.cents })
        .catch((err) =>
          console.error(
            `[store-server] failed to sync price for item ${item.id}:`,
            err
          )
        );
    }
    return {
      ...item,
      price_cents: info.cents > 0 ? info.cents : item.price_cents,
      image_url: info.imageUrl,
    };
  });
}

/** url → {cents, imageUrl} for every Payment Link on the account
 *  (first 100 — far above the catalog's size). Null when Stripe is
 *  unreachable. */
async function getLinkInfoByUrl(): Promise<Map<string, LinkInfo> | null> {
  if (linkCache && Date.now() - linkCache.at < LINK_CACHE_TTL_MS) {
    return linkCache.byUrl;
  }
  try {
    const stripe = getStripeClient();
    const links = await stripe.paymentLinks.list({ limit: 100 });
    const byUrl = new Map<string, LinkInfo>();
    await Promise.all(
      links.data.map(async (link) => {
        try {
          const lineItems = await stripe.paymentLinks.listLineItems(link.id, {
            limit: 10,
            expand: ["data.price.product"],
          });
          const cents = lineItems.data.reduce(
            (sum, li) =>
              sum + (li.price?.unit_amount ?? 0) * (li.quantity ?? 1),
            0
          );
          // First product image across the line items (single-product
          // links in practice).
          let imageUrl = "";
          for (const li of lineItems.data) {
            const product = li.price?.product;
            if (
              product &&
              typeof product === "object" &&
              "images" in product &&
              Array.isArray(product.images) &&
              typeof product.images[0] === "string"
            ) {
              imageUrl = product.images[0];
              break;
            }
          }
          byUrl.set(link.url, { cents, imageUrl });
        } catch (err) {
          console.error(
            `[store-server] failed to price payment link ${link.id}:`,
            err
          );
        }
      })
    );
    linkCache = { at: Date.now(), byUrl };
    return byUrl;
  } catch (err) {
    console.error("[store-server] failed to list payment links:", err);
    return null;
  }
}
