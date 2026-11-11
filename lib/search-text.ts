/**
 * Apostrophe look-alikes that phones, Word and copy-paste put in
 * names in place of the plain `'` on a keyboard: curly quotes (‘ ’),
 * the modifier apostrophe (ʼ), prime (′), backtick and acute accent.
 *
 * Every search box folds these to `'` on BOTH sides of the match —
 * the typed query and the text being searched:
 *
 *   text.toLowerCase().replace(APOSTROPHE_VARIANTS, "'").includes(q)
 *
 * Without it a student saved as "Da’Maya" (curly, typed on a phone)
 * could not be found by typing "Da'Maya" on a keyboard, and the other
 * way round.
 */
export const APOSTROPHE_VARIANTS = /[‘’‛ʼʹ′`´]/g;

/** Lower-cases and folds apostrophe variants: the form both the query
 *  and the searched text are compared in. */
export function foldSearch(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(APOSTROPHE_VARIANTS, "'");
}
