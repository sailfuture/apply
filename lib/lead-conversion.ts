import {
  xano,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
  type XanoFamily,
  type XanoParent,
} from "@/lib/xano";
import { digitsOnly, updateLead } from "@/lib/leads";

/**
 * Lead → family conversion links.
 *
 * Each of the four lead tables carries a `registration_families_id`
 * FK (+ `converted_at` stamp) that records "this lead became that
 * applying family". The link is the ONLY stored fact — everything
 * downstream (applied / accepted / enrolled) is derived at read time
 * from the family's live application data, mirroring how
 * `deriveApplicationStatus` refuses to store a status string.
 *
 * Links get written three ways, all through here:
 *   1. Auto-match when a parent submits an application
 *      (`matchLeadsToFamilies({ familyId })` from /api/family-progress)
 *   2. The admin re-match sweep over every family
 *      (`matchLeadsToFamilies()` from /api/admin/lead-conversion)
 *   3. Manual link/unlink in the lead triage sheet
 *      (`writeLeadConversion` from /api/admin/leads)
 *
 * Matching compares the lead's email (case-insensitive) and phone
 * (bare digits) against every registration parent's. A key that maps
 * to MORE THAN ONE family is discarded entirely — a wrong link is
 * worse than a missing one, and the triage sheet's manual link covers
 * the ambiguous cases.
 */

/** 0 = "not linked" on both columns. Xano's edit endpoints silently
 *  skip empty inputs (null/""), so integer 0 is the only clear value
 *  that actually lands — same convention as `interest_level`. */
export const UNLINKED = 0;

// ── Per-source field access ──────────────────────────────────────────
// The four tables name their contact columns differently (see
// `buildLeadContactPatch` in lib/leads.ts); the matcher only needs
// email + phone + the current link, so this stays a small trio of
// accessors rather than another column map.

type AnyLeadRow = Record<string, unknown>;

function leadEmail(source: LeadNoteSource, row: AnyLeadRow): string {
  const raw =
    source === "inquiry" || source === "camp"
      ? row.primary_email
      : row.parent_email;
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function leadPhone(source: LeadNoteSource, row: AnyLeadRow): string {
  const raw =
    source === "inquiry" || source === "camp"
      ? row.primary_phone
      : row.parent_phone;
  return digitsOnly(String(raw ?? ""));
}

/** Current link on a lead row, coercing the FK whether Xano returns
 *  it raw or as an expanded `{ id }` relation object. Parameter is
 *  structural (not `AnyLeadRow`) so the typed lead interfaces pass
 *  without a cast. */
export function leadConvertedFamilyId(row: {
  registration_families_id?: unknown;
}): number {
  const v = row.registration_families_id;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return Number(v) || UNLINKED;
  if (v && typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    return typeof id === "number" ? id : Number(id) || UNLINKED;
  }
  return UNLINKED;
}

// ── Family contact index ─────────────────────────────────────────────

interface FamilyContactIndex {
  byEmail: Map<string, number>;
  byPhone: Map<string, number>;
}

function buildFamilyContactIndex(
  families: XanoFamily[],
  parents: XanoParent[]
): FamilyContactIndex {
  const familyByParentId = new Map<number, number>();
  for (const family of families) {
    for (const pid of xano.families.getParentIds(family)) {
      familyByParentId.set(pid, family.id);
    }
  }

  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();
  // Keys seen under two different families — poisoned for good, so a
  // later parent can't re-add a key an earlier conflict removed.
  const ambiguous = new Set<string>();

  const add = (map: Map<string, number>, key: string, familyId: number) => {
    if (!key || ambiguous.has(`${map === byEmail ? "e" : "p"}:${key}`)) return;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, familyId);
    } else if (existing !== familyId) {
      map.delete(key);
      ambiguous.add(`${map === byEmail ? "e" : "p"}:${key}`);
    }
  };

  for (const parent of parents) {
    const familyId = familyByParentId.get(parent.id);
    if (!familyId) continue;
    add(byEmail, (parent.email ?? "").trim().toLowerCase(), familyId);
    add(byPhone, digitsOnly(String(parent.phone ?? "")), familyId);
  }
  return { byEmail, byPhone };
}

// ── Writes ───────────────────────────────────────────────────────────

/**
 * Stamp (or clear, with `familyId = UNLINKED`) the conversion link on
 * one lead, verifying the echo — Xano silently drops inputs its edit
 * endpoint doesn't declare, so without the check a mis-wired endpoint
 * would report success while saving nothing. `dropped` names the
 * columns that didn't land; the caller decides whether that's a toast
 * (manual link) or a log line (auto-match).
 *
 * Inquiry leads also get their lifecycle `status` moved to
 * `"converted"` (back to `"active"` on unlink) so the Inquiries
 * page's own buckets stay truthful without a second admin action.
 */
export async function writeLeadConversion(
  source: LeadNoteSource,
  id: number,
  familyId: number
): Promise<{ row: AnyLeadRow; dropped: string[] }> {
  const linking = familyId > UNLINKED;
  const patch: Record<string, unknown> = {
    registration_families_id: familyId,
    converted_at: linking ? Date.now() : 0,
  };
  if (source === "inquiry") patch.status = linking ? "converted" : "active";

  const row = ((await updateLead(source, id, patch)) ?? {}) as AnyLeadRow;

  const dropped: string[] = [];
  if (leadConvertedFamilyId(row) !== familyId) {
    dropped.push("registration_families_id");
  }
  const echoedAt = Number(row.converted_at ?? 0) || 0;
  if (linking ? echoedAt === 0 : echoedAt !== 0) dropped.push("converted_at");
  return { row, dropped };
}

// ── Matching sweep ───────────────────────────────────────────────────

export interface LeadMatchSummary {
  /** Unlinked leads examined. */
  scanned: number;
  /** Links written (and verified as landed). */
  linked: number;
  linkedBySource: Record<LeadNoteSource, number>;
  /** Per-source Xano wiring problems — the edit endpoint dropped the
   *  conversion columns, so that source's links can't be saved until
   *  the inputs are exposed in Xano. */
  wiringWarnings: string[];
}

/**
 * Match unlinked leads against registration families by parent email
 * and phone, and stamp the link on every hit.
 *
 * With `familyId`, only links pointing at that one family are written
 * (the on-submit hook: the family just applied, sweep their leads in).
 * Without it, the whole lead pool is swept (the admin re-match action
 * — also the historical backfill, since it's the same operation).
 *
 * Already-linked leads are never touched — a manual link always wins
 * over what the matcher would have picked.
 */
export async function matchLeadsToFamilies(opts?: {
  familyId?: number;
}): Promise<LeadMatchSummary> {
  const targetFamilyId = opts?.familyId;
  const [families, parents, inquiries, campRows, waivers, tascoRows] =
    await Promise.all([
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.inquiries.getAll(),
      xano.summerCamp.getAll(),
      xano.websiteWaivers.getAll(),
      xano.tascoSummerVisits.getAll(),
    ]);
  const index = buildFamilyContactIndex(families, parents);

  const rowsBySource: Record<LeadNoteSource, AnyLeadRow[]> = {
    inquiry: inquiries as unknown as AnyLeadRow[],
    camp: campRows as unknown as AnyLeadRow[],
    visit: waivers as unknown as AnyLeadRow[],
    tasco: tascoRows as unknown as AnyLeadRow[],
  };

  const summary: LeadMatchSummary = {
    scanned: 0,
    linked: 0,
    linkedBySource: { inquiry: 0, camp: 0, visit: 0, tasco: 0 },
    wiringWarnings: [],
  };

  for (const source of LEAD_NOTE_SOURCES) {
    for (const row of rowsBySource[source]) {
      if (leadConvertedFamilyId(row) > UNLINKED) continue;
      summary.scanned++;

      const email = leadEmail(source, row);
      const phone = leadPhone(source, row);
      const matched =
        (email ? index.byEmail.get(email) : undefined) ??
        (phone ? index.byPhone.get(phone) : undefined);
      if (!matched) continue;
      if (targetFamilyId !== undefined && matched !== targetFamilyId) continue;

      try {
        const { dropped } = await writeLeadConversion(
          source,
          Number(row.id),
          matched
        );
        if (dropped.includes("registration_families_id")) {
          // The link column itself didn't land — every other write to
          // this source will fail the same way, so say so once and
          // stop hammering the table.
          summary.wiringWarnings.push(
            `${source}: Xano dropped ${dropped.join(", ")} — expose them as inputs on the table's edit endpoint.`
          );
          break;
        }
        summary.linked++;
        summary.linkedBySource[source]++;
      } catch (err) {
        console.error(
          `[matchLeadsToFamilies] link failed for ${source} #${row.id} → family ${matched}:`,
          err
        );
      }
    }
  }
  return summary;
}
