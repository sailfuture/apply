import {
  xano,
  type XanoFamily,
  type XanoInquiry,
  type XanoParent,
  type XanoSummerCampInquiry,
} from "@/lib/xano";
import { toE164 } from "@/lib/phone";

/**
 * Unified SMS contact model. A phone number that texts us — or that
 * staff want to text — can belong to three kinds of records:
 *
 *   - `family`  — an applying/enrolled family (`registration_families`,
 *                 matched via its parents' phones). The primary,
 *                 highest-trust relationship.
 *   - `camp`    — a summer-camp parent (`registration_summer_camp`,
 *                 standalone rows with their own phone/email).
 *   - `inquiry` — a prospective-family inquiry (`registration_inquiry`).
 *
 * When one number matches more than one record type (an inquiry that
 * converted to a family; a camp parent who later applied), attribution
 * follows `family > camp > inquiry` so the thread lands on the most
 * established record.
 *
 * Messages are deliberately NOT year-scoped: a contact's thread is one
 * continuous history across academic years (the optional year id on a
 * message row is trigger context, never a filter).
 */

export type SmsContactType = "family" | "inquiry" | "camp";

export interface SmsContact {
  type: SmsContactType;
  /** Row id in the type's own table. */
  id: number;
  /** Thread display name — the family name for families, the
   *  parent/guardian's name for camp + inquiry contacts. */
  name: string;
  /** The human on the phone (parent/guardian full name). */
  personName: string;
  /** Student context when the record carries it (camp + inquiry rows
   *  name their student inline; family student names are looked up
   *  separately where needed). */
  studentNames: string | null;
  phone: string;
  e164: string | null;
  optedOut: boolean;
  /** For family contacts: the matched parent row — STOP/START
   *  bookkeeping writes `sms_opted_out_at` there. */
  parentId: number | null;
}

/** Bare 10-digit form — single normalization rule shared by the
 *  webhook, the Twilio sync, and this directory so all three attribute
 *  a number identically. */
export function normPhone(raw: string | number | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/* ─────────────── Family recipient helpers (canonical home) ─────────────── */

/**
 * Account-holder pick from a family's parent rows: the Clerk-linked
 * parent (owns the login) first, else the lowest-id parent — the same
 * "primary" convention the email layer uses. ONE shared rule for every
 * SMS surface (per-family sends, triggers, group blasts) so they all
 * target the same phone.
 */
export function pickAccountHolderParent(
  parents: XanoParent[]
): XanoParent | null {
  if (!parents.length) return null;
  return (
    parents.find((p) => p.clerk_user_id) ??
    [...parents].sort((a, b) => a.id - b.id)[0]
  );
}

/**
 * The account-holder parent for a family — the "primary account phone"
 * the texts target. Loads the family's parent rows and applies
 * `pickAccountHolderParent`.
 */
export async function resolvePrimaryParent(
  familyId: number
): Promise<XanoParent | null> {
  try {
    const family = await xano.families.getById(familyId);
    if (!family) return null;
    const ids = xano.families.getParentIds(family);
    if (!ids.length) return null;
    const parents = (
      await Promise.all(
        ids.map((id) => xano.parents.getById(id).catch(() => null))
      )
    ).filter((p): p is XanoParent => p != null);
    return pickAccountHolderParent(parents);
  } catch {
    return null;
  }
}

export interface FamilyRecipient {
  parentId: number | null;
  name: string;
  /** Bare stored phone (10-digit) for display. */
  phone: string;
  /** E.164, or null when the number is missing/invalid. */
  e164: string | null;
  optedOut: boolean;
}

/** Recipient summary for the messages UI — who a text would go to and
 *  whether they've opted out. Null when the family has no parent. */
export async function getFamilyRecipient(
  familyId: number
): Promise<FamilyRecipient | null> {
  const parent = await resolvePrimaryParent(familyId);
  if (!parent) return null;
  return {
    parentId: parent.id,
    name: `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim(),
    phone: parent.phone ?? "",
    e164: toE164(parent.phone),
    optedOut: Boolean(parent.sms_opted_out_at),
  };
}

/* ───────────────────────── Contact directory ───────────────────────── */

function familyContact(family: XanoFamily, parent: XanoParent): SmsContact {
  return {
    type: "family",
    id: family.id,
    name: family.family_name || `Family #${family.id}`,
    personName:
      `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim(),
    studentNames: null,
    phone: parent.phone ?? "",
    e164: toE164(parent.phone),
    optedOut: Boolean(parent.sms_opted_out_at),
    parentId: parent.id,
  };
}

function campContact(row: XanoSummerCampInquiry): SmsContact {
  const personName =
    `${row.primary_parent_first_name ?? ""} ${row.primary_parent_last_name ?? ""}`.trim();
  return {
    type: "camp",
    id: row.id,
    name: personName || `Camp #${row.id}`,
    personName,
    studentNames:
      `${row.student_first_name ?? ""} ${row.student_last_name ?? ""}`.trim() ||
      null,
    phone: row.primary_phone ?? "",
    e164: toE164(row.primary_phone),
    // No opt-out column on camp rows — Twilio's carrier-level STOP
    // still blocks sends to a number that opted out.
    optedOut: false,
    parentId: null,
  };
}

function inquiryContact(row: XanoInquiry): SmsContact {
  const personName =
    `${row.primary_first_name ?? ""} ${row.primary_last_name ?? ""}`.trim();
  const phone = String(row.primary_phone ?? "");
  return {
    type: "inquiry",
    id: row.id,
    name: personName || `Inquiry #${row.id}`,
    personName,
    studentNames:
      `${row.student_first_name ?? ""} ${row.student_last_name ?? ""}`.trim() ||
      null,
    phone,
    e164: toE164(phone),
    // The inquiry form has an explicit messaging consent checkbox —
    // respect a "no". Legacy rows without the flag default to opted
    // out being false only when explicitly opted in? No: treat
    // anything except an explicit `false` as contactable, since the
    // column always exists on inquiry rows and staff-initiated texts
    // to warm leads are the whole point of matching inquiries.
    optedOut: row.messaging_opt_in === false,
    parentId: null,
  };
}

/**
 * Phone → contact directory across all three record types. Four table
 * scans total (families, parents, camp, inquiries), then first-wins
 * insertion in priority order so `family > camp > inquiry` on
 * collisions. Numbers that don't normalize to 10 digits are skipped.
 */
export async function buildSmsDirectory(): Promise<Map<string, SmsContact>> {
  const [families, parents, campRows, inquiries] = await Promise.all([
    xano.families.getAll().catch(() => [] as XanoFamily[]),
    xano.parents.getAll().catch(() => [] as XanoParent[]),
    xano.summerCamp.getAll().catch(() => [] as XanoSummerCampInquiry[]),
    xano.inquiries.getAll().catch(() => [] as XanoInquiry[]),
  ]);

  const directory = new Map<string, SmsContact>();
  const add = (key: string, contact: SmsContact) => {
    if (key.length === 10 && !directory.has(key)) directory.set(key, contact);
  };

  const parentById = new Map(parents.map((p) => [p.id, p]));
  for (const family of families) {
    for (const pid of xano.families.getParentIds(family)) {
      const parent = parentById.get(pid);
      if (!parent) continue;
      add(normPhone(parent.phone), familyContact(family, parent));
    }
  }
  for (const row of campRows) {
    add(normPhone(row.primary_phone), campContact(row));
  }
  for (const row of inquiries) {
    add(normPhone(row.primary_phone), inquiryContact(row));
  }
  return directory;
}

/** Resolve one raw number (any format) to a contact, or null. Builds
 *  the directory fresh — fine for webhook-frequency lookups. */
export async function findSmsContactByPhone(
  raw: string
): Promise<SmsContact | null> {
  const key = normPhone(raw);
  if (key.length !== 10) return null;
  const directory = await buildSmsDirectory();
  return directory.get(key) ?? null;
}

/**
 * Recipient summary for a contact of any type — powers the thread
 * composer ("who will this go to, can we text them"). Family contacts
 * defer to the account-holder rule; camp + inquiry rows carry their
 * own phone.
 */
export async function getContactRecipient(
  type: SmsContactType,
  id: number
): Promise<FamilyRecipient | null> {
  if (type === "family") return getFamilyRecipient(id);
  if (type === "camp") {
    const rows = await xano.summerCamp.getAll().catch(() => []);
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    const c = campContact(row);
    return {
      parentId: null,
      name: c.personName,
      phone: c.phone,
      e164: c.e164,
      optedOut: c.optedOut,
    };
  }
  const row = await xano.inquiries.getById(id).catch(() => null);
  if (!row) return null;
  const c = inquiryContact(row);
  return {
    parentId: null,
    name: c.personName,
    phone: c.phone,
    e164: c.e164,
    optedOut: c.optedOut,
  };
}

/** The `sms_messages` foreign-key trio for a contact — exactly one of
 *  the three ids is set. Shared by every code path that logs a row so
 *  a message can never be attributed to two records. */
export function contactMessageKeys(
  contact: { type: SmsContactType; id: number } | null
): {
  registration_families_id: number | null;
  registration_inquiry_id: number | null;
  registration_summer_camp_id: number | null;
} {
  return {
    registration_families_id:
      contact?.type === "family" ? contact.id : null,
    registration_inquiry_id:
      contact?.type === "inquiry" ? contact.id : null,
    registration_summer_camp_id:
      contact?.type === "camp" ? contact.id : null,
  };
}
