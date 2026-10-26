/**
 * Mid-year student additions — a student added to an already-enrolled
 * family's year after the family moved through the pipeline as a unit.
 *
 * Two kinds, each marked on its own `registration_application` row:
 *   - `is_residential_addition` — foster placements added by a
 *     residential family. No admissions review, no tuition (see
 *     `/api/residential-students`).
 *   - `is_midyear_addition` — a sibling added by any other enrolled
 *     family. Goes through the normal steps for ONE student: student
 *     details + Financial Aid + NWEA, admissions review of that
 *     student, then registration + tuition (see `/api/student-additions`).
 *
 * The apply → accept → register lifecycle is family + year scoped
 * (one shared progress row, enrolled = EVERY packet confirmed), so a
 * pending addition must stay out of those family-level rollups until
 * admin confirms that student's packet. Otherwise one new student
 * bounces the whole family off their enrolled dashboard, re-fires
 * family-wide emails, or gets billed before they're accepted.
 */

export interface AdditionMarkers {
  is_residential_addition?: boolean | null;
  is_midyear_addition?: boolean | null;
}

/** Either kind of mid-year addition. */
export function isMidYearAddition(app: AdditionMarkers | null | undefined) {
  return (
    app?.is_residential_addition === true || app?.is_midyear_addition === true
  );
}

/**
 * Still pending: a mid-year addition whose packet admin hasn't
 * confirmed. These are the rows every family-level rollup skips.
 * Once the packet is confirmed the student counts like any other.
 */
export function isPendingMidYearAddition(
  app: AdditionMarkers | null | undefined,
  packetConfirmed: boolean
) {
  return isMidYearAddition(app) && !packetConfirmed;
}

/**
 * Student ids of every mid-year addition in `apps` — the shape the
 * packet rollups want (packets join back to applications by student).
 */
export function midYearAdditionStudentIds(
  apps: (AdditionMarkers & { registration_students_id?: number | null })[]
): Set<number> {
  return new Set(
    apps
      .filter((a) => isMidYearAddition(a))
      .map((a) => Number(a.registration_students_id))
  );
}

/** Where a sibling addition (`is_midyear_addition`) stands. */
export type AdditionStage =
  /** Parent is still filling in the application. */
  | "application"
  /** Submitted; waiting on admin to accept this student. */
  | "review"
  /** Accepted (packet exists); parent completes registration. */
  | "registration";

export function additionStage(
  app: { addition_submitted_at?: number | null },
  hasPacket: boolean
): AdditionStage {
  if (hasPacket) return "registration";
  if ((app.addition_submitted_at ?? 0) > 0) return "review";
  return "application";
}
