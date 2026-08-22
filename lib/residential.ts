/**
 * Residential (foster placement) homes.
 *
 * SailFuture runs two residential houses; a residential student lives in
 * exactly one of them. The value is stored evergreen on the STUDENT row
 * (`registration_students.residential_house`) rather than the per-year
 * packet, so a placement follows the student across school years.
 *
 * Shared so the three places that touch it — the family-facing "Create
 * New Registration" sheet, the API that persists it, and the admin
 * Placement card — can never drift into different spellings. A typo'd
 * house is worse than a blank one: it silently splits a roster.
 */

export const RESIDENTIAL_HOUSES = ["Lakewood", "Waterfront"] as const;

export type ResidentialHouse = (typeof RESIDENTIAL_HOUSES)[number];

/** Narrow an untrusted string to a known house. Returns null for
 *  anything else, including the empty string — callers decide whether
 *  "unset" is an error or simply means "not assigned yet". */
export function parseResidentialHouse(
  value: unknown
): ResidentialHouse | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (
    RESIDENTIAL_HOUSES.find(
      (house) => house.toLowerCase() === trimmed.toLowerCase()
    ) ?? null
  );
}
