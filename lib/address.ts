/**
 * Mailing-address columns shared by `registration_parents` and
 * `registration_emergency_contacts`. Every field is optional on the
 * input side so partially filled rows (most families record a street
 * and a zip, little else) still format cleanly.
 */
export interface MailingAddressFields {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}

/**
 * Format a mailing address on one line for read-only display:
 * "123 Main St, Apt 4, St. Petersburg, FL 33701". Blank parts are
 * skipped, so a row with only a city and state reads
 * "St. Petersburg, FL" rather than leaving stray commas. Returns ""
 * when every field is empty so callers can fall back to their own
 * placeholder.
 */
export function formatAddressOneLine(a: MailingAddressFields): string {
  const clean = (v: string | null | undefined) => (v ?? "").trim();
  const stateZip = [clean(a.state), clean(a.zipcode)]
    .filter(Boolean)
    .join(" ");
  const cityLine = [clean(a.city), stateZip].filter(Boolean).join(", ");
  return [clean(a.address_line_1), clean(a.address_line_2), cityLine]
    .filter(Boolean)
    .join(", ");
}
