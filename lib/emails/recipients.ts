/**
 * Internal "awareness" CC list. The admissions team + dean need
 * visibility into mail the school sends families, so these addresses
 * are CC'd on:
 *   - every transactional Resend send (the default CC in
 *     `lib/emails/send.ts`)
 *   - admin-drafted parent emails (the "Email parent" mailto button
 *     in `components/admin/email-parent-button.tsx`)
 *
 * Kept here as the single source of truth so those two paths can't
 * drift. Pure data with no imports, so it's safe to pull into client
 * components (the mailto button) without dragging server-only email
 * code into the client bundle.
 */
export const INTERNAL_CC_EMAILS = [
  "admissions@sailfuture.org",
  "dean@sailfuture.org",
] as const;
