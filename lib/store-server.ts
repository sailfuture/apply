import { extractOrderCustomFields } from "@/lib/store";
import { getStripeClient } from "@/lib/stripe";
import { xano } from "@/lib/xano";
import type { XanoStoreItem, XanoStoreOrder } from "@/lib/xano";

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

/* ────────────────── Order healing (backfill) ────────────────── */

/**
 * lower-cased parent email → family id, for attributing checkouts
 * that arrived without a portal `client_reference_id`. Parent rows
 * carry no family FK — the linkage is the family row's
 * `registration_parents_id` list, so this joins the two tables.
 * Returns null when either roster fails to load.
 */
export async function buildFamilyByParentEmail(): Promise<Map<
  string,
  number
> | null> {
  try {
    const [families, parents] = await Promise.all([
      xano.families.getAll(),
      xano.parents.getAll(),
    ]);
    const emailById = new Map<number, string>();
    for (const p of parents) {
      const email = (p.email ?? "").trim().toLowerCase();
      if (email) emailById.set(p.id, email);
    }
    const familyByEmail = new Map<string, number>();
    for (const f of families) {
      for (const entry of f.registration_parents_id ?? []) {
        // Entries are plain ids or embedded parent objects depending
        // on the endpoint's addon config — accept both.
        const pid =
          typeof entry === "number"
            ? entry
            : entry && typeof entry === "object" && "id" in entry
              ? Number((entry as { id: unknown }).id)
              : NaN;
        const email = Number.isFinite(pid) ? emailById.get(pid) : undefined;
        if (email && !familyByEmail.has(email)) {
          familyByEmail.set(email, f.id);
        }
      }
    }
    return familyByEmail;
  } catch (err) {
    console.error("[store-server] parent-email roster load failed:", err);
    return null;
  }
}

/** Sessions we've already asked Stripe about and found no custom
 *  fields on — don't re-probe them every admin page load. Module
 *  cache, per serverless instance. */
const probedEmptySessions = new Set<string>();

/** Cap Stripe lookups per healing pass so one admin load can't fan
 *  out into dozens of API calls. */
const HEAL_STRIPE_LOOKUP_CAP = 20;

/**
 * Retroactively repair store orders that predate a capture feature
 * (or arrived through a bare link):
 *
 *   1. Unattributed rows (family 0) with a purchaser email are
 *      matched against the parent roster and stamped with the
 *      family id.
 *   2. Rows missing size/student_name get their Checkout Session's
 *      custom fields fetched from Stripe.
 *
 * All repairs are persisted back to Xano best-effort and reflected
 * in the returned rows either way, so the caller renders healed data
 * even if a write is dropped (e.g. columns not wired yet).
 */
export async function healStoreOrders(
  orders: XanoStoreOrder[]
): Promise<XanoStoreOrder[]> {
  if (orders.length === 0) return orders;

  // ── 1. Email-based attribution ──
  const unattributed = orders.filter(
    (o) => !Number(o.registration_families_id) && (o.purchaser_email ?? "").trim()
  );
  const familyByEmail =
    unattributed.length > 0 ? await buildFamilyByParentEmail() : null;

  // ── 2. Custom-field backfill ──
  let stripeLookups = 0;

  return Promise.all(
    orders.map(async (order) => {
      let healed = order;
      const patch: Partial<XanoStoreOrder> = {};

      if (
        familyByEmail &&
        !Number(healed.registration_families_id)
      ) {
        const fid = familyByEmail.get(
          (healed.purchaser_email ?? "").trim().toLowerCase()
        );
        if (fid) {
          patch.registration_families_id = fid;
          healed = { ...healed, registration_families_id: fid };
        }
      }

      const missingFields =
        !(healed.size ?? "").trim() && !(healed.student_name ?? "").trim();
      if (
        missingFields &&
        healed.stripe_checkout_session_id &&
        !probedEmptySessions.has(healed.stripe_checkout_session_id) &&
        stripeLookups < HEAL_STRIPE_LOOKUP_CAP
      ) {
        stripeLookups++;
        try {
          const session = await getStripeClient().checkout.sessions.retrieve(
            healed.stripe_checkout_session_id
          );
          const fields = extractOrderCustomFields(session.custom_fields);
          if (fields.size || fields.student_name) {
            patch.size = fields.size;
            patch.student_name = fields.student_name;
            healed = { ...healed, ...fields };
          } else {
            probedEmptySessions.add(healed.stripe_checkout_session_id);
          }
        } catch (err) {
          console.error(
            `[store-server] session lookup failed for ${healed.stripe_checkout_session_id}:`,
            err
          );
        }
      }

      if (Object.keys(patch).length > 0) {
        // Best-effort persist — dropped silently if the columns/inputs
        // aren't wired in Xano yet; the healed row still renders.
        void xano.storeOrders
          .update(order.id, patch)
          .catch((err) =>
            console.error(
              `[store-server] failed to persist heal for order ${order.id}:`,
              err
            )
          );
      }
      return healed;
    })
  );
}
