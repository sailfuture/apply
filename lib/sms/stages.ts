import type {
  XanoFamilyApplicationProgress,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/**
 * Family pipeline-stage bucketing for SMS surfaces — ONE definition
 * shared by the group-message audience and the inbox's stage filter so
 * the two can never disagree about which families count as enrolled /
 * registration / applying.
 *
 * Pure function over prefetched rows (callers own their fetches —
 * both surfaces already load these tables for other reasons):
 *
 *   - enrolled     — family-level `isRegistrationConfirmed` on a
 *                    non-archived registration-progress row
 *   - registration — accepted for the year (merged per-family flags,
 *                    so duplicate progress rows can't split a family
 *                    across buckets)
 *   - application  — submitted but not accepted
 *
 * Buckets are mutually exclusive: enrolled > registration > application.
 */
export interface FamilyStageSets {
  enrolled: Set<number>;
  registration: Set<number>;
  application: Set<number>;
}

export function computeFamilyStageSets(input: {
  /** Year-scoped rows — callers fetch via `getByYear`, so no year
   *  filtering happens here. */
  fap: XanoFamilyApplicationProgress[];
  srp: XanoStudentRegistrationProgress[];
}): FamilyStageSets {
  const { fap, srp } = input;

  const enrolled = new Set<number>();
  for (const r of srp) {
    if (r.isArchived === true) continue;
    if (r.isRegistrationConfirmed === true) {
      enrolled.add(r.registration_families_id);
    }
  }

  // Merge apply-progress flags per family BEFORE bucketing — a family
  // can carry duplicate progress rows for a year.
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

  // No denied-family exclusion: per-application `isDenied` never
  // existed as a column, so the old check could never fire — and with
  // no deny path in the app, no family can be in a denied state.
  const registration = new Set<number>();
  const application = new Set<number>();
  for (const [fid, f] of applyFlags) {
    if (enrolled.has(fid)) continue;
    if (f.accepted) registration.add(fid);
    else if (f.submitted) application.add(fid);
  }

  return { enrolled, registration, application };
}
