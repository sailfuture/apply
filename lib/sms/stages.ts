import type {
  XanoApplication,
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
 *   - application  — submitted but not accepted, EXCLUDING families
 *                    whose every active application was denied
 *
 * Buckets are mutually exclusive: enrolled > registration > application.
 */
export interface FamilyStageSets {
  enrolled: Set<number>;
  registration: Set<number>;
  application: Set<number>;
}

export function computeFamilyStageSets(input: {
  yearId: number;
  fap: XanoFamilyApplicationProgress[];
  srp: XanoStudentRegistrationProgress[];
  apps: XanoApplication[];
}): FamilyStageSets {
  const { yearId, fap, srp, apps } = input;

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

  // Families whose every active application for the year was denied —
  // they keep `isSubmitted` progress rows but must not count as
  // "applying".
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

  const registration = new Set<number>();
  const application = new Set<number>();
  for (const [fid, f] of applyFlags) {
    if (enrolled.has(fid)) continue;
    if (f.accepted) registration.add(fid);
    else if (f.submitted && !deniedFamilies.has(fid)) application.add(fid);
  }

  return { enrolled, registration, application };
}
