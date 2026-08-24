/**
 * Human labels for the Toddle student fields a sync can change.
 *
 * Its own module, deliberately: the sync reports changed fields by
 * their API names ("gradeLevel", "addressLine1"), and the admin UI has
 * to render those. Importing `lib/toddle.ts` into a client component
 * to get this map would drag the whole API client — tokens, fetches,
 * env reads — into the browser bundle.
 */

const TODDLE_FIELD_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "school email",
  dob: "date of birth",
  gender: "gender",
  phoneNumber: "phone",
  enrollmentDate: "enrollment date",
  gradeLevel: "grade level",
  addressLine1: "address",
  addressLine2: "address line 2",
  city: "city",
  state: "state",
  zipcode: "ZIP code",
  crew: "crew",
};

/** "gradeLevel" → "grade level"; unknown keys pass through so a field
 *  added on the API side still renders as something readable. */
export function toddleFieldLabel(field: string): string {
  return TODDLE_FIELD_LABELS[field] ?? field;
}

/** "school email, grade level and phone" — an inline list for a toast
 *  or a table cell. Empty input returns an empty string. */
export function formatToddleFieldList(fields: string[]): string {
  const labels = fields.map(toddleFieldLabel);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
