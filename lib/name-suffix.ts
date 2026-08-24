/**
 * Generational suffixes — "Jr.", "III" — stripped from a name before
 * it's used as an identifier.
 *
 * They're titles, not part of the name, and they're the single biggest
 * source of two-records-for-one-child. A suffix tends to be typed into
 * one system and not the other, and because the school email is
 * DERIVED from the name it corrupts the address too
 * ("craig.mebanejr25@" vs "craig.mebane25@") — so the name matcher and
 * the email matcher miss at the same time and a duplicate gets
 * created. Removing the suffix at both boundaries closes that.
 *
 * This never touches the stored Xano name. The family's own record
 * keeps "Craig Mebane Jr." — this is about what we generate and what
 * we push, not about editing what they told us.
 *
 * Own module (no imports) so the client bundle and `lib/toddle.ts`
 * can both use it without dragging anything along.
 */

/** Only a TRAILING suffix, only as a whole word, and only after a
 *  separator — so "Ivy", "Vega" and a name that IS "Ivy" survive. */
const TRAILING_SUFFIX = /[\s,]+(jr|jnr|sr|snr|ii|iii|iv|2nd|3rd|4th)\.?$/i;

/** "Craig Mebane Jr." → "Craig Mebane"; "Petros III" → "Petros". */
export function stripNameSuffix(name: string | null | undefined): string {
  let out = (name ?? "").trim();
  // Twice, because "Smith Jr. III" turns up and one pass leaves half.
  for (let i = 0; i < 2; i++) out = out.replace(TRAILING_SUFFIX, "").trim();
  return out;
}
