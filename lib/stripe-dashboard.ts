/**
 * Static Stripe Dashboard URLs for the SailFuture account.
 *
 * The account id is baked into these URLs (`acct_14Q7ZhIftywQifYZ`)
 * so admin links always open in the right Stripe account regardless
 * of which account the admin's browser is currently scoped to. Live
 * + test mode both live under the same account; Stripe handles the
 * mode picker in the dashboard chrome.
 *
 * If we ever switch Stripe accounts (acquisition, separate entity for
 * a new school, etc.), update `STRIPE_ACCOUNT_ID` below.
 */

export const STRIPE_ACCOUNT_ID = "acct_14Q7ZhIftywQifYZ";

const baseUrl = `https://dashboard.stripe.com/${STRIPE_ACCOUNT_ID}`;

/** Global invoices view — all invoices across every customer. */
export const STRIPE_INVOICES_DASHBOARD_URL = `${baseUrl}/invoices`;

/** Customer-scoped Dashboard URL — opens the family's customer page,
 *  which lists their invoices, subscriptions, and payment history. */
export function stripeCustomerDashboardUrl(customerId: string): string {
  return `${baseUrl}/customers/${customerId}`;
}
