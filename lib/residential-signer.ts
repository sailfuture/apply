/**
 * The adult who signs a residential student's liability waiver and
 * enrollment agreement: the case worker or legal guardian, who is not
 * the caregiver logged into the portal (the caregiver adds the student
 * and fills in the packet, but has no legal authority to sign).
 *
 * Stored per student, per school year on the registration packet
 * (`registration_student_registration.signer_*`, added 2026-11-23), so
 * a new case worker next year doesn't rewrite last year's record.
 * Entered by the caregiver on the residential packet form, or by staff
 * on the enrolled student page.
 *
 * Xano's packet PATCH drops empty strings, so a field can be replaced
 * but never blanked; readers treat a signer with no email as missing.
 */

export const SIGNER_ROLES = ["Case worker", "Legal guardian", "Other"] as const;

export interface ResidentialSigner {
  signer_role: string;
  signer_first_name: string;
  signer_last_name: string;
  signer_email: string;
  /** 10 digits, or "" when not given. */
  signer_phone: string;
  signer_agency: string;
}

export const SIGNER_FIELDS = [
  "signer_role",
  "signer_first_name",
  "signer_last_name",
  "signer_email",
  "signer_phone",
  "signer_agency",
] as const satisfies ReadonlyArray<keyof ResidentialSigner>;

type SignerSource = Partial<Record<keyof ResidentialSigner, string | null>>;

/** Everything on the row, trimmed; "" for anything unset. */
export function signerFromRow(row: SignerSource | null | undefined): ResidentialSigner {
  return {
    signer_role: row?.signer_role?.trim() ?? "",
    signer_first_name: row?.signer_first_name?.trim() ?? "",
    signer_last_name: row?.signer_last_name?.trim() ?? "",
    signer_email: row?.signer_email?.trim() ?? "",
    signer_phone: row?.signer_phone?.trim() ?? "",
    signer_agency: row?.signer_agency?.trim() ?? "",
  };
}

export function isValidSignerEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Enough to send a document: a name to address and a valid email. */
export function isSignerComplete(s: ResidentialSigner): boolean {
  return (
    !!s.signer_role &&
    !!s.signer_first_name &&
    !!s.signer_last_name &&
    isValidSignerEmail(s.signer_email)
  );
}

export function signerFullName(s: ResidentialSigner): string {
  return `${s.signer_first_name} ${s.signer_last_name}`.trim();
}

/**
 * Validate a client-sent signer patch. Returns only the signer keys
 * present in `body`, cleaned, or an error message. Empty values are
 * dropped (Xano would ignore them anyway).
 */
export function cleanSignerPatch(
  body: Record<string, unknown>
): { patch: Partial<ResidentialSigner> } | { error: string } {
  const patch: Partial<ResidentialSigner> = {};
  for (const key of SIGNER_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw != null && typeof raw !== "string") {
      return { error: `${key} must be text.` };
    }
    let value = (raw ?? "").trim().slice(0, 200);
    if (!value) continue;
    if (key === "signer_email") {
      value = value.toLowerCase();
      if (!isValidSignerEmail(value)) {
        return { error: "Enter a valid email address for the signer." };
      }
    }
    if (key === "signer_phone") {
      const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (digits.length !== 10) {
        return { error: "Enter a 10-digit phone number for the signer." };
      }
      value = digits;
    }
    patch[key] = value;
  }
  return { patch };
}
