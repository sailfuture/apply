import { formatUSPhone } from "@/lib/phone";
import { pandaDocDate, schoolTodayIso } from "@/lib/pandadoc";

/**
 * Prefill values for the free and reduced lunch letter (the state's
 * household meal application), keyed by MERGE FIELD name.
 *
 * PandaDoc matches a prefill to a field by the field's "Merge Field"
 * property, not its Field ID. A field with no merge field set simply
 * isn't filled, so every name below is safe to send whether or not the
 * template uses it: the template opts in field by field.
 *
 * What we fill:
 *   - the adult signing: name, mailing address, phone, email
 *   - today's date
 *
 * What we deliberately leave to the parent: the whole child grid (names,
 * middle initials, grades, the foster / migrant / runaway / homeless
 * boxes), every income line, the household count, the SSN digits and the
 * case number. The grid lists every child in the HOUSEHOLD, which can
 * include children who aren't SailFuture students, so the parent fills
 * it in themselves rather than starting from a partial list.
 */

export interface LunchLetterAdult {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();

export function lunchLetterPrefill(input: {
  /** The adult signing: the signed-in parent, or the primary parent on
   *  an admin send. Null when their record couldn't be loaded. */
  adult: LunchLetterAdult | null;
}): Record<string, string> {
  const out: Record<string, string> = {};

  const adult = input.adult;
  if (adult) {
    const name = `${clean(adult.first_name)} ${clean(adult.last_name)}`.trim();
    out.adult_full_name = name;
    out.mailing_address = [clean(adult.address_line_1), clean(adult.address_line_2)]
      .filter(Boolean)
      .join(", ");
    out.mailing_city = clean(adult.city);
    out.mailing_state = clean(adult.state);
    out.mailing_zip = clean(adult.zipcode);
    out.adult_phone = formatUSPhone(adult.phone);
    out.adult_email = clean(adult.email);
  }

  out.today_date = pandaDocDate(schoolTodayIso());
  return out;
}
