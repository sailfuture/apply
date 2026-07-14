import { xano, type XanoParent } from "@/lib/xano";
import { toE164 } from "@/lib/phone";
import { pickAccountHolderParent } from "@/lib/sms/send";

/**
 * Resolve the recipient set for a group SMS blast from the three
 * targeting dimensions the product supports: school year (required),
 * pipeline stage, and billing status. Every blast is scoped by at
 * least the year — there is no unfiltered broadcast.
 *
 * Stages are derived from the per-year progress rows and are mutually
 * exclusive (enrolled > accepted > applicant), with flags merged
 * per-family FIRST so duplicate progress rows can't land one family in
 * two buckets. Families whose every active submitted application was
 * denied are dropped from the applicant bucket — a "text all
 * applicants" blast must not include families we turned down.
 * Recipients + their phones / opt-out come from
 * `families.getAllDetails()` in a single fetch. Used by both the group
 * send and its dry-run preview.
 */

export type Stage = "applicant" | "accepted" | "enrolled";

export interface GroupAudienceFilters {
  yearId: number;
  /** Empty = every family with activity in the year (any stage). */
  stages: Stage[];
  /** Narrow to families carrying an outstanding balance for the year. */
  onlyOutstanding: boolean;
}

export interface GroupRecipient {
  familyId: number;
  familyName: string;
  parentName: string;
  /** The picked account-holder parent row — passed through to
   *  `sendSms` so its opt-out gate stays the single consent
   *  authority. Null when the family has no parents on file. */
  parent: XanoParent | null;
  e164: string | null;
  optedOut: boolean;
  /** We'd actually text this family (has a valid number + not opted out). */
  sendable: boolean;
}

export interface GroupAudience {
  recipients: GroupRecipient[];
  /** Families matching the filters (regardless of reachability). */
  matched: number;
  /** Matching families we can actually text. */
  sendable: number;
  optedOut: number;
  noPhone: number;
}

export async function resolveGroupAudience(
  filters: GroupAudienceFilters
): Promise<GroupAudience> {
  const { yearId, stages, onlyOutstanding } = filters;

  const [fap, srp, apps, txns, families] = await Promise.all([
    xano.familyApplicationProgress.getByYear(yearId).catch(() => []),
    xano.studentRegistrationProgress.getByYear(yearId).catch(() => []),
    xano.applications.getAll().catch(() => []),
    onlyOutstanding
      ? xano.paymentTransactions.getAllByYear(yearId).catch(() => [])
      : Promise.resolve([]),
    xano.families.getAllDetails().catch(() => []),
  ]);

  const enrolled = new Set<number>();
  for (const r of srp) {
    if (r.isArchived === true) continue;
    if (r.isRegistrationConfirmed === true) {
      enrolled.add(r.registration_families_id);
    }
  }

  // Merge apply-progress flags per family BEFORE bucketing — a family
  // can carry duplicate progress rows for a year (data anomalies,
  // legacy re-creates), and a row-by-row `else if` would drop one
  // family into both the accepted and applicant buckets.
  const applyFlags = new Map<
    number,
    { submitted: boolean; accepted: boolean }
  >();
  for (const p of fap) {
    if (p.is_archived === true) continue;
    const fid = p.registration_families_id;
    const f = applyFlags.get(fid) ?? { submitted: false, accepted: false };
    f.submitted = f.submitted || p.isSubmitted === true;
    f.accepted = f.accepted || p.isAccepted === true;
    applyFlags.set(fid, f);
  }

  // Families whose every active application for the year was denied.
  // They still carry `isSubmitted` progress rows, but a blast to
  // "applicants" shouldn't text them. A family with at least one
  // non-denied active application stays in.
  const deniedFamilies = new Set<number>();
  {
    const byFamily = new Map<number, { total: number; denied: number }>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const fid = Number(a.registration_families_id);
      if (!fid) continue;
      const b = byFamily.get(fid) ?? { total: 0, denied: 0 };
      b.total += 1;
      if (a.isDenied === true) b.denied += 1;
      byFamily.set(fid, b);
    }
    for (const [fid, b] of byFamily) {
      if (b.total > 0 && b.denied === b.total) deniedFamilies.add(fid);
    }
  }

  // Mutually-exclusive buckets: enrolled wins over accepted wins over
  // applicant.
  const accepted = new Set<number>();
  const applicant = new Set<number>();
  for (const [fid, f] of applyFlags) {
    if (enrolled.has(fid)) continue;
    if (f.accepted) accepted.add(fid);
    else if (f.submitted && !deniedFamilies.has(fid)) applicant.add(fid);
  }

  // Union of the selected stages (or all three when none selected).
  const wanted = new Set<number>();
  const includeAll = stages.length === 0;
  const add = (set: Set<number>) => set.forEach((id) => wanted.add(id));
  if (includeAll || stages.includes("applicant")) add(applicant);
  if (includeAll || stages.includes("accepted")) add(accepted);
  if (includeAll || stages.includes("enrolled")) add(enrolled);

  // Optional billing narrow — keep only families with a positive
  // outstanding balance on their open/uncollectible invoices.
  if (onlyOutstanding) {
    const balByFamily = new Map<number, number>();
    for (const t of txns) {
      if (t.status !== "open" && t.status !== "uncollectible") continue;
      const bal = (t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0);
      if (bal <= 0) continue;
      balByFamily.set(
        t.registration_families_id,
        (balByFamily.get(t.registration_families_id) ?? 0) + bal
      );
    }
    for (const id of [...wanted]) {
      if ((balByFamily.get(id) ?? 0) <= 0) wanted.delete(id);
    }
  }

  const detailsById = new Map(families.map((f) => [f.id, f]));
  const recipients: GroupRecipient[] = [...wanted]
    .map((familyId) => {
      const fam = detailsById.get(familyId);
      const parent = pickAccountHolderParent(
        fam?.registration_parents_id ?? []
      );
      const e164 = toE164(parent?.phone ?? null);
      const optedOut = Boolean(parent?.sms_opted_out_at);
      return {
        familyId,
        familyName: (fam?.family_name || "").trim() || `Family #${familyId}`,
        parentName: parent
          ? `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim()
          : "",
        parent,
        e164,
        optedOut,
        sendable: Boolean(e164) && !optedOut,
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));

  return {
    recipients,
    matched: recipients.length,
    sendable: recipients.filter((r) => r.sendable).length,
    optedOut: recipients.filter((r) => r.optedOut).length,
    noPhone: recipients.filter((r) => !r.e164).length,
  };
}
