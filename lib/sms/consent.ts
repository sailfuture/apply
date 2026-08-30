/**
 * SMS consent bookkeeping shared by every surface that captures or
 * displays the registration-checkbox opt-in (welcome page via
 * POST /api/families, the apply-flow parent card via
 * PATCH /api/parents/[id], and the family-step checkbox state).
 *
 * One rule lives here: what a checked/unchecked consent box writes to
 * the parent row, and how to read the row back into a checkbox state.
 */

/** Consent provenance written when the parent actively checks the box. */
export const SMS_CONSENT_GRANTED_SOURCE = "registration_checkbox";
/** Provenance written when the parent saw the consent language and
 *  declined — prefixed "declined" so reads can treat any declined_*
 *  value as a negative decision. */
export const SMS_CONSENT_DECLINED_SOURCE = "declined_registration_checkbox";

/**
 * Parent-row field writes for a consent decision.
 *   granted  → provenance + clear any opt-out (0 sentinel, NOT null —
 *              Xano PATCH silently drops null/empty inputs).
 *   declined → the parent explicitly declined automated texts, so
 *              stamp the opt-out timestamp exactly like a STOP reply;
 *              the distinct provenance lets admin tell the two apart
 *              (and opt the family back in from the messages inbox if
 *              the parent asks).
 */
export function smsConsentParentFields(consented: boolean): {
  sms_consent_source: string;
  sms_opted_out_at: number;
} {
  return consented
    ? { sms_consent_source: SMS_CONSENT_GRANTED_SOURCE, sms_opted_out_at: 0 }
    : {
        sms_consent_source: SMS_CONSENT_DECLINED_SOURCE,
        sms_opted_out_at: Date.now(),
      };
}

/**
 * Checkbox state for a parent row. True only when an affirmative
 * consent is on file AND no opt-out has landed since (a STOP reply
 * after consenting wins). Legacy parents with no recorded decision
 * (implied-consent era) read as unchecked — the box is an invitation
 * to record express consent, and re-checking it is harmless.
 */
export function hasAffirmativeSmsConsent(parent: {
  sms_consent_source?: string | null;
  sms_opted_out_at?: number | null;
}): boolean {
  const source = parent.sms_consent_source ?? "";
  return (
    !!source && !source.startsWith("declined") && !parent.sms_opted_out_at
  );
}
