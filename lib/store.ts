/**
 * School store — helpers around the admin-managed `store_items`
 * catalog (each item wraps a Stripe Payment Link created in the
 * Stripe Dashboard).
 *
 * The portal appends `client_reference_id=family-<id>-year-<yid>` and
 * `prefilled_email` to each item's link so the resulting
 * `checkout.session.completed` webhook event can be attributed to the
 * purchasing family — a bare link shared outside the portal still
 * works, it just lands as an unattributed order.
 */

/** Payment-link checkout URL carrying the family reference + prefilled
 *  purchaser email. `client_reference_id` allows [A-Za-z0-9_-] only. */
export function storeCheckoutUrl(
  paymentLinkUrl: string,
  familyId: number,
  yearId: number | null,
  email: string | null | undefined
): string {
  const params = new URLSearchParams();
  params.set(
    "client_reference_id",
    `family-${familyId}${yearId ? `-year-${yearId}` : ""}`
  );
  if (email) params.set("prefilled_email", email);
  return `${paymentLinkUrl}${paymentLinkUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Parse the `client_reference_id` the portal stamped onto a checkout.
 *  Returns zeros for bare/foreign references. */
export function parseStoreReference(ref: string | null | undefined): {
  familyId: number;
  yearId: number;
} {
  const m = /^family-(\d+)(?:-year-(\d+))?$/.exec(ref ?? "");
  return {
    familyId: m ? Number(m[1]) : 0,
    yearId: m?.[2] ? Number(m[2]) : 0,
  };
}

/** "$15" / "$12.50" — trims trailing .00 for clean price chips. */
export function formatPriceCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}

export interface StoreItemPatch {
  name?: string;
  description?: string;
  payment_link_url?: string;
  is_active?: boolean;
  sort_order?: number;
}

/**
 * Validation shared by the admin store-item POST (all fields required)
 * and PATCH (partial) routes. `payment_link_url` must be a Stripe
 * Payment Link (buy.stripe.com) so the webhook's session→order mirror
 * is guaranteed to fire for every purchase.
 */
export function parseStoreItemBody(
  body: unknown,
  { requireAll }: { requireAll: boolean }
): StoreItemPatch | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;
  const out: StoreItemPatch = {};

  if ("name" in b || requireAll) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { error: "name is required" };
    out.name = name;
  }
  if ("description" in b) {
    out.description =
      typeof b.description === "string" ? b.description.trim() : "";
  }
  // price_cents is never client-supplied — it's a server-synced cache
  // of the Payment Link's Stripe price (see lib/store-server.ts).
  if ("payment_link_url" in b || requireAll) {
    const url =
      typeof b.payment_link_url === "string" ? b.payment_link_url.trim() : "";
    if (!/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+$/.test(url)) {
      return {
        error:
          "payment_link_url must be a Stripe Payment Link (https://buy.stripe.com/…)",
      };
    }
    out.payment_link_url = url;
  }
  if ("is_active" in b) out.is_active = b.is_active === true;
  if ("sort_order" in b) {
    const n = Number(b.sort_order);
    out.sort_order = Number.isFinite(n) ? Math.round(n) : 0;
  }
  return out;
}
