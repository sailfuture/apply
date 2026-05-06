const BASE_URL = process.env.XANO_API_BASE_URL;

function getBaseUrl() {
  if (!BASE_URL) throw new Error("XANO_API_BASE_URL is not configured");
  return BASE_URL;
}

export interface XanoParent {
  id: number;
  created_at: number;
  clerk_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  invite_status: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

export interface XanoFamily {
  id: number;
  created_at: number;
  family_name: string;
  bus_transportation: boolean;
  registration_students_id: (number | Record<string, unknown> | unknown[])[];
  registration_parents_id: (number | Record<string, unknown> | unknown[])[];
  registration_fee_waiver_id: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIds(items: any[]): number[] {
  return items
    .filter((item) => item != null && !(Array.isArray(item) && item.length === 0))
    .map((item) => (typeof item === "number" ? item : item?.id))
    .filter((id): id is number => typeof id === "number");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParents(items: any[]): XanoParent[] {
  return items.filter(
    (item): item is XanoParent =>
      item != null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.id === "number"
  );
}

export interface XanoStudent {
  id: number;
  created_at: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  photo: string | null;
  registration_families_id: number;
  registration_school_years_id: number[];
  isArchived: boolean;
  isAccepted: boolean;
  /** IDs of every `registration_student_registration` (packet) row this
   *  student has. One per year — Xano side adds a new row on re-enrollment,
   *  so this list grows over multi-year enrollment. */
  registration_student_registration_id: number[];
  // --- Document arrays (evergreen, live on the student) --------------------
  // Parents can upload multiple files per category (e.g. two pages of a
  // passport, a stack of medical forms). Each entry is Xano's file metadata
  // shape — `{ path, url, mime, size, meta, ... }`.
  birth_certificate: Record<string, unknown>[];
  school_health_form: Record<string, unknown>[];
  transcripts: Record<string, unknown>[];
  immunization_forms: Record<string, unknown>[];
  passport: Record<string, unknown>[];
  student_state_id: Record<string, unknown>[];
  iep: Record<string, unknown>[];
  ssn_card: Record<string, unknown>[];

  /** Admin-only initial-screening NWEA scores + dates. Recorded
   *  after the student completes initial testing at the academy.
   *  Live on the student row (not the per-year application) since
   *  test scores follow the student across cycles. Optional on the
   *  type — values are null until admin enters them through the
   *  Initial Testing card on the family detail page. */
  initial_screening_nwea_math?: number | null;
  initial_screening_nwea_reading?: number | null;
  initial_screening_nwea_math_date?: string | null;
  initial_screening_nwea_reading_date?: string | null;

  /** Admin verification flag for the student's registration packet.
   *  Renamed from the per-packet `registrationConfirmed` so the
   *  audit lives on the student (one source of truth across
   *  multiple year packets). Verify Student Name Registration
   *  button on the family registration detail page flips this. */
  is_verified?: boolean;
  /** Timestamp when admin verified the student. */
  is_admin_verified_time?: number | null;
  /** Display name of the admin who verified the student. */
  is_admin_verified_admin?: string;
  /** Last-edited timestamp on the student row. Bumped whenever any
   *  admin or parent write changes the row; surfaced on the admin
   *  enrolled-detail page so admin can see at a glance how recent
   *  the data is. */
  last_edited_time?: number | null;
}

export interface XanoApplication {
  id: number;
  created_at: number;
  registration_students_id: number;
  registration_families_id: number;
  registration_application_status_id: number;
  registration_school_years_id: number;
  registration_parents_id: number;
  type: string;
  current_previous_school: string;
  describe_student_opportunities_for_growth: string;
  describe_student_strengths: string;
  sufs_type: string;
  sufs_status: string;
  sufs_award_id: number;
  /** Admin "I've verified this SUFS selection" flag. Predecessor of
   *  `confirmed_scholarship` below — kept on the type for any
   *  legacy rows that still carry it, but new writes go to
   *  `confirmed_scholarship`. The Approve gate + per-student
   *  Confirm Scholarship Award Amount button both read/write
   *  `confirmed_scholarship` only. */
  sufs_confirmed?: boolean;
  /** Admin "I've reviewed this student's full scholarship award
   *  (SUFS + Opportunity Scholarship) and locked it in" flag. The
   *  per-student Confirm Scholarship Award Amount button on the
   *  Scholarship Determination card flips this; the family-level
   *  Approve gate requires every active student's
   *  `confirmed_scholarship === true` before it'll fire.
   *
   *  Renamed from `sufs_confirmed` because the button covers more
   *  than SUFS now — admin's per-student award includes the
   *  Opportunity Scholarship cost determination too. Optional on
   *  the type because legacy rows predate the column; the gate
   *  treats undefined as `false` (admin still needs to confirm). */
  confirmed_scholarship?: boolean;
  is_bus_transportation: boolean;
  bus_stop: string;
  /** Captured snapshot of which parent address the family used to pick
   *  the bus stop — written as a single formatted string so the
   *  routing team has the literal pickup address tied to the student's
   *  application without having to look up the parent record. Only set
   *  when `is_bus_transportation` is true and a parent address was
   *  selected. Optional because legacy rows predate the column. */
  primary_home?: string;
  test_scores: Record<string, unknown> | null;
  nwea_testing_complete: boolean;
  nwea_testing_scheduled: boolean;
  /** Admin-only NWEA RIT score for the math screening, recorded
   *  after the student completes initial testing at the academy.
   *  Null until admin enters it from the Initial Testing card on
   *  the family detail page. Parents never see or write this
   *  field — it's gated to the admin allowlist. */
  initial_screening_nwea_math?: number | null;
  /** Admin-only NWEA RIT score for the reading screening. Same
   *  gating as `initial_screening_nwea_math`. */
  initial_screening_nwea_reading?: number | null;
  /** Date the math screening was administered (ISO `YYYY-MM-DD`).
   *  Stored as a string so a missing time component doesn't drift
   *  with timezone math. */
  initial_screening_nwea_math_date?: string | null;
  /** Date the reading screening was administered. Same shape as
   *  `initial_screening_nwea_math_date`. */
  initial_screening_nwea_reading_date?: string | null;
  last_grade_completed: string;
  current_grade: string;
  isSubmitted: boolean;
  isOffered: boolean;
  isAccepted: boolean;
  /** Set true when admin denies an application that was submitted. Mutually
   *  exclusive with `isOffered` / `isAccepted` in practice — admin tools
   *  flip exactly one of the decision booleans on a submitted application.
   *  Optional because legacy rows predate the column. */
  isDenied?: boolean;
  /** Soft-delete / inclusion flag. New applications are created with
   *  `isActive = true`. When a parent removes a student from a year, we
   *  flip this to `false` instead of deleting the row, so historical
   *  data is preserved. Admin views filter to `isActive = true` only —
   *  flagged optional because legacy rows predate the column and treat
   *  missing/undefined as "active by default" downstream. */
  isActive?: boolean;
  /**
   * Family's annual out-of-pocket toward tuition for this student.
   * The Opportunity Scholarship covers everything between SUFS and
   * this amount. Stored as a number for non-SNAP families; gets
   * PATCH'd to `null` once admin confirms SNAP benefits, since SNAP
   * families' tuition + transport are auto-rebated by the
   * Opportunity Scholarship and admin shouldn't see a stale dollar
   * figure on the row. Optional/null on the type so the SNAP
   * cascade can clear it.
   */
  opportunity_scholarship_award_amount: number | null;
  // PandaDoc enrollment-agreement state. Liability-waiver fields used
  // to live here too but moved to `registration_student_registration`
  // (the per-student packet) — those fields are no longer on this
  // table. Enrollment agreement is currently authored on the
  // family-level progress row instead, so these may also be legacy
  // depending on cycle.
  enrollment_agreement_pandadoc_id: string;
  enrollment_agreement_status: string;
  enrollment_agreement_sent_at: string | null;
  enrollment_agreement_pdf_url: string;
}

export interface XanoApplicationStatus {
  id: number;
  created_at: number;
  status_name: string;
}

export interface XanoSchoolYear {
  id: number;
  created_at: number;
  year_name: string;
  start_date: string | null;
  end_date: string | null;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  fes_eo_9: number;
  fes_eo_8: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
  opportunity_scholarship_award: number;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
  application_deadline: string | null;
  opportunity_scholarship_deadline: string | null;
}

export interface XanoFamilyPayment {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  isFamilyAccepted: boolean;
  signature: Record<string, unknown>;
  name: string;
  signature_data: Record<string, unknown> | null;
  registration_fee_waiver_id: number | null;
  monthly_tuition_payment: number;
  /** Total annual admin fees the family owes for the year — `$500 × N`
   *  for N active students. Snapshotted at family approval time so the
   *  billing surfaces don't have to recompute from per-student rows.
   *  Optional on the type because legacy rows pre-date the column. */
  annual_fee_total?: number | null;
  /** Total annual transportation the family owes for the year. Sum of
   *  per-student transport fees for students whose
   *  `is_bus_transportation=true`. Set to `null` for SNAP families
   *  (transportation is waived for them) so downstream consumers can
   *  render N/A rather than `$0` and avoid charging in error.
   *  Optional on the type because legacy rows pre-date the column. */
  transportation_total?: number | null;
  tuition_reviewed: boolean;
  tuition_reviewed_at: number | null;
  tuition_reviewed_by: string;
  enrollment_agreement_pandadoc_id: string;
  enrollment_agreement_status: string;
  enrollment_agreement_sent_at: string | null;
  enrollment_agreement_pdf_url: string;
  is_enrollment_agreement_signed: boolean;
}

export interface XanoScholarship {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  household_adults: number;
  household_children: number;
  no_contributing_member: boolean;
  business_income_monthly: number;
  capital_gains_monthly: number;
  child_support_monthly: number;
  alimony_monthly: number;
  trusts_monthly: number;
  other_income_monthly: number;
  describe_other_income: string;
  assets_checking: number;
  assets_savings: number;
  assets_retirement_savings: number;
  assets_stocks_bonds_securities: number;
  assets_trusts_inheritance: number;
  assets_business: number;
  debts_credit_cards: number;
  debts_student_loans: number;
  debts_personal_loans: number;
  government_benefits: boolean;
  snap_benefits: Record<string, unknown>[];
  /** Admin verification trail for the SNAP award letter. Same pattern
   *  as the contributing-member `*_confirm` columns: the bool flips
   *  when admin marks the document reviewed; the audit timestamp +
   *  confirming-admin teacher id are server-stamped automatically.
   *  All optional because the columns were added after launch. */
  is_snap_confirmed?: boolean;
  snap_confirm_time?: number | null;
  snap_confirm_admin?: number;
  other_benefits: Record<string, unknown>[];
  family_contribution_per_month: number;
  scholarship_advocacy_letter: string;
  signature: Record<string, unknown> | null;
  /** Proof of unemployment / job termination — required when the family
   *  marks "no contributing members" on the scholarship. Multi-file array
   *  so a packet of letters can all live on one row. Replaces the older
   *  single-file `termination_letter` column. */
  unemployment_letter: Record<string, unknown>[];
  /** Admin verification trail for the unemployment letter. Same shape
   *  as SNAP above. NB: column is `is_unemployment_confirm` (no `_ed`
   *  suffix) on Xano — typed faithfully. */
  is_unemployment_confirm?: boolean;
  unemployment_confirm_time?: number | null;
  unemployment_confirm_admin?: number;
  last_edited: number | null;

  /* ─────── Admin-only relation expansions ───────
   * The `admin_family_application` Xano query optionally expands a
   * single contributing member, a single home, and a single vehicle
   * onto the scholarship row. Field names are Xano's auto-generated
   * `_<table>_of_<table>` shape; aliased here as optional props so
   * normal client-side reads (which don't fetch the admin endpoint)
   * stay unaffected.
   *
   * Note: Xano's expansion currently surfaces a single object per
   * relation, not an array. Families with multiple contributing
   * members / homes / vehicles will only see the first. If the
   * endpoint moves to multi-row expansion later, switch the type to
   * `... | (... )[]` and handle both.
   */
  // Xano's expansion aliases gain numeric suffixes when the same
  // relation is referenced more than once in a query — the
  // `admin_family_application` query has gone through a few revisions
  // and the suffixes drifted. Type both the suffix-less and
  // numeric-suffixed variants so reads can fall back gracefully if
  // Xano renames an alias later. Always read via
  // `getScholarshipMember` / `getScholarshipHome` /
  // `getScholarshipVehicle` (defined below) so the fallback chain
  // lives in one place.
  _registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship?:
    | XanoScholarshipContributingMember
    | null;
  _registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship_1?:
    | XanoScholarshipContributingMember
    | null;
  _registration_opportunity_scholarship_home_of_registration_opportunity_scholarship?:
    | XanoScholarshipHome
    | null;
  _registration_opportunity_scholarship_home_of_registration_opportunity_scholarship_3?:
    | XanoScholarshipHome
    | null;
  _registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship?:
    | XanoScholarshipVehicle
    | null;
  _registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship_2?:
    | XanoScholarshipVehicle
    | null;
  isNotParticipating: boolean;
  isSNAPBenefits: boolean;
  isOpportunityScholarship: boolean;
}

export interface XanoScholarshipBenefit {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  amount_monthly: number;
  /** Per-benefit documentation (award letter, approval notice, etc.).
   *  Multi-file array — one benefit can need several pages of paperwork. */
  benefit_documentation: Record<string, unknown>[];
  /** Admin verification trail — same pattern as the contributing-member
   *  `*_confirm` columns. The admin documents-review surface flips
   *  `benefit_is_confirmed`; the API route auto-stamps the timestamp
   *  (`benefit_confirm_time`) and the confirming admin's teacher id
   *  (`benefit_confirm_admin`). All three optional because legacy
   *  rows predate them. */
  benefit_is_confirmed?: boolean;
  benefit_confirm_time?: number | null;
  benefit_confirm_admin?: number;
}

export interface XanoScholarshipContributingMember {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  first_name: string;
  last_name: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  estimated_annual_income: number;
  isW2: boolean;
  isPayStubs: boolean;
  /** Income verification slots are multi-file arrays — a W-2 packet or
   *  a pay-stub can span multiple pages. The page-side `toFileArray`
   *  helper normalizes legacy single-object values it might still see
   *  during the schema transition. */
  w2: Record<string, unknown>[];
  paystub_1: Record<string, unknown>[];
  paystub_2: Record<string, unknown>[];
  paystub_3: Record<string, unknown>[];
  paystub_4: Record<string, unknown>[];
  /** Per-document confirmation bools. Each `*_confirm` mirrors a
   *  matching file slot and flips to `true` once admin reviews that
   *  specific upload and marks it correct. The overall `is_verified`
   *  flag below is gated on all the relevant `*_confirm` values being
   *  true (along with the declared method matching what's actually
   *  uploaded), so admin can chip away at a member's documents one at
   *  a time and the overall row only flips when everything checks out.
   *  Optional because the columns were added after launch — undefined
   *  is treated as `false` by every reader. */
  w2_confirm?: boolean;
  paystub_1_confirm?: boolean;
  paystub_2_confirm?: boolean;
  paystub_3_confirm?: boolean;
  paystub_4_confirm?: boolean;
  /** Audit trail for each per-document confirmation:
   *   - `*_confirm_time` — millis timestamp set the moment admin marked
   *     the slot confirmed. Cleared (set to null) on undo.
   *   - `*_admin_confirm` — the confirming admin's teacher id
   *     (numeric). 0 when unset. The admin documents-review surface
   *     never writes these directly; the contributing-members PATCH
   *     endpoint stamps them automatically when a `*_confirm` flag
   *     is being flipped, so the audit trail can't drift away from
   *     the boolean's actual state. */
  w2_confirm_time?: number | null;
  paystub_1_confirm_time?: number | null;
  paystub_2_confirm_time?: number | null;
  paystub_3_confirm_time?: number | null;
  paystub_4_confirm_time?: number | null;
  w2_admin_confirm?: number;
  paystub_1_admin_confirm?: number;
  paystub_2_admin_confirm?: number;
  paystub_3_admin_confirm?: number;
  paystub_4_admin_confirm?: number;
  /** Admin-side overall verification flag. Set true when admin has
   *  ticked every per-document confirm above and is satisfied the
   *  uploaded packet matches the declared income. Hand-edits flow
   *  through the admin contributing-members PATCH endpoint, which is
   *  the only place these columns are exposed for write. */
  is_verified?: boolean;
}

export interface XanoScholarshipHome {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  total_value: number;
  outstanding_debt: number;
}

export interface XanoScholarshipVehicle {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  car_make: string;
  car_model: string;
  car_year: string;
  total_value: number;
  remaining_debt: number;
}

export interface XanoBusStop {
  id: number;
  created_at: number;
  name: string;
  pick_up_time: number;
  drop_off_time: number;
  address: string;
}

/**
 * Enriched family record returned by `/registration_families_all_details`.
 * Mirrors `XanoFamily` but with the FK arrays already expanded:
 *   - `registration_students_id` → array of full application rows
 *     (one row per student per academic year for that family)
 *   - `registration_parents_id` → array of full parent rows
 *
 * Xano's relationship expansion can insert empty `[]` items where an FK
 * didn't resolve. Always run results through `cleanFamilyAllDetails` (or
 * use `xano.families.getAllDetails()`, which does it for you) before
 * touching the arrays — the cleaner narrows them to the object shape.
 */
export interface XanoFamilyAllDetails {
  id: number;
  created_at: number;
  family_name: string;
  /** Despite the column name, each item here is a `registration_application`
   *  row — the inner `registration_students_id` field is the FK to the
   *  student. */
  registration_students_id: XanoApplication[];
  registration_parents_id: XanoParent[];
  registration_emergency_contacts_id: number[];
  // `isAccepted` / `isSubmitted` were dropped from `registration_families`
  // — they live on `family_application_progress` per academic year now.
}

/**
 * Strip Xano's empty-array artifacts from the expanded relationship arrays.
 * Xano inserts `[]` in place of unresolved FKs; we narrow to actual row
 * objects so downstream code can iterate without type guards.
 */
function cleanFamilyAllDetails(raw: unknown): XanoFamilyAllDetails {
  const r = raw as Partial<XanoFamilyAllDetails> & {
    registration_students_id?: unknown[];
    registration_parents_id?: unknown[];
  };
  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  return {
    id: Number(r.id ?? 0),
    created_at: Number(r.created_at ?? 0),
    family_name: typeof r.family_name === "string" ? r.family_name : "",
    registration_students_id: Array.isArray(r.registration_students_id)
      ? (r.registration_students_id.filter(isObj) as XanoApplication[])
      : [],
    registration_parents_id: Array.isArray(r.registration_parents_id)
      ? (r.registration_parents_id.filter(isObj) as XanoParent[])
      : [],
    registration_emergency_contacts_id: Array.isArray(
      r.registration_emergency_contacts_id
    )
      ? (r.registration_emergency_contacts_id.filter(
          (v): v is number => typeof v === "number"
        ) as number[])
      : [],
  };
}

/**
 * Enriched per-packet view returned by `/registration_student_registration_details`.
 *
 * Single fetch returns:
 *   - the packet itself (every column from `registration_student_registration`)
 *   - `_registration_type` — full RegistrationType row
 *   - `_registration_school_years_1` — full SchoolYear row
 *   - `_registration_students_1` — array containing the linked student row
 *     (always one element; Xano returns it as an array because the
 *     relationship engine treats it that way)
 *
 * Powers the admin per-student multi-year history page — one round trip
 * per packet gets us packet + year + student + type info ready to render.
 */
export interface XanoRegistrationDetails extends XanoStudentRegistration {
  _registration_type: XanoRegistrationType | null;
  _registration_school_years_1: XanoSchoolYear | null;
  _registration_students_1: XanoStudent[];
}

/**
 * One cell in the per-year family payment matrix. The matrix axes are
 * household size (rows) and annual-income brackets (columns); each row
 * in this table is a single cell.
 *
 * `tuition_percentage` is a **percentage (0–100, decimal)** of the
 * year's base tuition AND base transportation fees that the family is
 * expected to pay. Both dollar figures are derived at render time:
 *
 *   tuition_owed   = school_year.tuition             * tuition_percentage / 100
 *   transport_owed = school_year.transportation_fees * tuition_percentage / 100
 *
 * Cells are independently PATCH-able so the admin matrix editor can
 * persist a single cell change without re-sending the rest of the
 * matrix. `income_max` is nullable to model the rightmost "and up"
 * column (no upper bound).
 *
 * Stored in the `registration_school_year_award_brackets` Xano table.
 */
export interface XanoSchoolYearAwardBracket {
  id: number;
  created_at: number;
  registration_school_years_id: number;
  household_size: number;
  income_min: number;
  income_max: number | null;
  /** Percentage (0–100, decimal) of base tuition + transportation the family pays. */
  tuition_percentage: number;
}

/**
 * One row in the per-year "high net assets" sliding scale — applies
 * to families whose net assets exceed $100k. Unlike the regular
 * tuition matrix, this is a 1D list (asset bracket only — household
 * size is irrelevant once a family clears the net-assets threshold).
 *
 * Column names differ from the regular award_brackets table because
 * the semantics differ:
 *   - `net_asset_min` / `net_asset_max` — the asset bracket bounds
 *     (max is nullable for the rightmost "and up" row)
 *   - `percentage_of_total_tuition` — share of base tuition the
 *     family pays for that bracket (decimal, 0–100)
 *
 * Stored in the `registration_school_year_net_assets_bracket` Xano
 * table.
 */
export interface XanoSchoolYearNetAssetsBracket {
  id: number;
  created_at: number;
  registration_school_years_id: number;
  net_asset_min: number;
  net_asset_max: number | null;
  /** Percentage of total tuition the family pays, 0–100 (decimal). */
  percentage_of_total_tuition: number;
}

/**
 * Aggregated admin view of one family's application+scholarship state for
 * a specific school year. Backed by the `admin_family_application` Xano
 * endpoint, which takes `registration_families_id` and
 * `registration_school_years_id` as inputs.
 *
 * Shape mirrors what Xano returns — notably `scholarship` is an array
 * (typically 0 or 1 element) and `application` is one row per student
 * for that family/year.
 */
export interface XanoAdminFamilyDetail {
  scholarship: XanoScholarship[];
  application: XanoApplication[];
  family: {
    id: number;
    created_at: number;
    family_name: string;
    registration_students_id: number[];
    registration_parents_id: number[];
    registration_emergency_contacts_id: number[];
  };
  school_year: XanoSchoolYear;
}

/**
 * Admin-authored note attached to a family. Surfaces on the admin family
 * detail page as a chronological comms log; pinned notes float to the top.
 *
 * `registration_students_id` and `registration_school_years_id` are
 * optional foreign keys — set them when the note is specifically about
 * one student or one academic year, leave null for a family-wide note.
 *
 * `author_email` / `author_name` are denormalized at write time so the
 * note still renders correctly if a staff member is later archived from
 * `/teachers_by_admin`.
 */
export interface XanoAdminNote {
  id: number;
  created_at: number;
  /** Family the note belongs to. Mutually exclusive with
   *  `registration_inquiry_id` — a note is tied to one or the other,
   *  never both. Stored as `0`/`null` for inquiry-scoped notes. */
  registration_families_id: number;
  registration_students_id: number | null;
  registration_school_years_id: number | null;
  /** Inquiry the note belongs to, if this is an inquiry-scoped note.
   *  Optional because the column was added after launch and family
   *  notes still have it null/undefined. */
  registration_inquiry_id?: number | null;
  /** Per-student registration progress row this note belongs to. Set
   *  for notes that are about a specific student's post-acceptance
   *  registration packet (e.g. a stalled volunteer-hours stage). All
   *  three of these progress-row foreign keys are mutually exclusive
   *  with each other and with `registration_inquiry_id` — pick one
   *  scope at write time. Optional because the columns were added
   *  after launch. */
  registration_student_registration_progress_id?: number | null;
  /** Re-apply family progress row this note belongs to. */
  reapply_family_progress_id?: number | null;
  /** Apply-flow family progress row this note belongs to. */
  registration_family_application_progress_id?: number | null;
  /** Freeform section key for scoping a note to a specific surface
   *  inside the family detail page — e.g.
   *  `contributing_member:42`, `scholarship.review`, or
   *  `application:18.testing`. The admin Notes drawer for that
   *  surface filters its timeline + writes new notes with this set
   *  so a single family's comms log can splinter cleanly per-surface
   *  without losing the unified timeline. Optional because legacy
   *  notes (and any general family-wide note) leave it null. */
  section?: string | null;
  /** Parent visibility flag — admin opt-in. When true, the note is
   *  surfaced to the parent on their side (read-only). False means
   *  internal-only (the admin comms log). Default treats undefined
   *  as `false` so legacy notes stay internal until explicitly
   *  shared. */
  is_shared_with_parent?: boolean;
  author_email: string;
  author_name: string;
  body: string;
  /** Free-form bucket — currently 'phone' | 'email' | 'in-person' | 'sms' | 'other'. */
  category: string;
  is_pinned: boolean;
  /** Timestamp of the last edit; null if never edited. */
  last_edited: number | null;
}

export interface XanoInquiry {
  id: number;
  created_at: number;
  primary_first_name: string;
  primary_last_name: string;
  primary_email: string;
  primary_phone: number;
  student_first_name: string;
  student_last_name: string;
  current_grade: string;
  starting_grade: string;
  previous_school: string;
  about_student: string;
  hear_about_us: string;
  messaging_opt_in: boolean;
  /** Admin "we've reached out" flag. Optional because legacy rows
   *  predate the column — undefined is treated as `false` everywhere
   *  the value is read. */
  isFollowedUp?: boolean;
  /** Server-managed timestamp of the most recent note added to this
   *  inquiry's comms log. Bumped automatically by the notes POST
   *  endpoint; the inquiries PATCH endpoint does NOT expose it on
   *  its allowlist so admins can't hand-edit it. */
  last_reach_out?: number | null;
}

/** Lookup table — distinguishes new applicants from returning enrollments. */
export interface XanoRegistrationType {
  id: number;
  created_at: number;
  type: string; // "New Application" | "New Enrollment" | "Re-Enrollment"
}

/** Bridge row: one per family per school year. Tracks explicit section-complete
 *  booleans so the UI doesn't have to re-derive completion from field presence.
 *  Also the canonical home for the per-year `isSubmitted` and `isAccepted`
 *  booleans — they used to live on `registration_families` but moved here
 *  because acceptance is per-year-per-family, not per-family-forever. */
export interface XanoFamilyApplicationProgress {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  family_completed: boolean;
  students_completed: boolean;
  financial_aid_completed: boolean;
  testing_completed: boolean;
  last_edited: number | null;
  submitted_at: number | null;
  /** Hard submission flag — true once the parent has clicked Submit and the
   *  application has been locked. `submitted_at` is the timestamp of that
   *  click; `isSubmitted` is the durable bool the dashboard reads to show
   *  the "Application Submitted" banner and gate further edits. */
  isSubmitted: boolean;
  /** Admin decision flag — true once the family has been accepted for the
   *  year. Drives the parent-side "Welcome to the Academy" view and the
   *  global header's chrome (apply vs. registration). */
  isAccepted: boolean;
  registration_type_id: number;
  /** IDs of every `registration_application` row attached to this
   *  family + year. Maintained by the application-create flow so admins
   *  can pull the per-family application set straight off the progress
   *  row without a separate `apps?registration_families_id=…` round
   *  trip. May be missing on legacy rows; treat as empty when absent. */
  registration_application_id?: number[];
  /** Admin-side archive flag. True once an admin has decided the
   *  family's application for this year is no longer active (e.g.
   *  duplicate, withdrawn, no follow-through). Mutually exclusive
   *  with the active workflow — archived rows drop out of admin
   *  review queues. Optional because the column was added after
   *  launch; undefined/false both mean "not archived". */
  is_archived?: boolean;
  /** Required text reason captured at archive time. Surfaces in the
   *  admin row's archive history and gives the next admin context
   *  for why the family was set aside. Optional on the type because
   *  legacy rows have it null; the archive UI requires non-empty
   *  text on write. */
  reason_for_archive?: string | null;

  // ── Admin section-confirm pairs ────────────────────────────────
  // Each section has up to three columns: a bool flag, an audit
  // timestamp, and (for Family + Students only) an audit admin name
  // string. Testing intentionally omits the admin string column —
  // there's no `testing_admin_confirm_admin` on Xano, so we skip it.
  //
  // Admin clicks `Confirm <Section>` on the apply-flow detail page;
  // we flip `*_admin_confirm` true, stamp `Date.now()` on
  // `*_admin_confirm_time`, and stamp the admin's display name on
  // `*_admin_confirm_admin`. Approach B: when the parent edits any
  // data belonging to that section, the bool auto-clears back to
  // false, time → null, admin → "".
  //
  // Financial Aid is intentionally absent — the Scholarship
  // Determination card already has its own per-student confirmation
  // flow (`confirmed_scholarship` on each app), so a section-level
  // duplicate would be redundant.
  family_admin_confirm?: boolean;
  family_admin_confirm_time?: number | null;
  family_admin_confirm_admin?: string;
  students_admin_confirm?: boolean;
  students_admin_confirm_time?: number | null;
  students_admin_confirm_admin?: string;
  testing_admin_confirm?: boolean;
  testing_admin_confirm_time?: number | null;
}

/**
 * Shape returned by `/reapply_family_progress_by_year` — same fields as
 * `XanoReapplyFamilyProgress` plus the inline-expanded family record
 * under `_registration_families`. Used by the admin Reapply list so
 * we don't need a separate families join.
 */
export interface ReapplyProgressRow {
  id: number;
  created_at: number;
  registration_school_years_id: number;
  registration_families_id: number;
  last_edited: number | null;
  isScholarship: boolean;
  isTransportation: boolean;
  isFamilyDetails: boolean;
  isStudentDetails: boolean;
  isSubmitted: boolean;
  _registration_families: {
    id: number;
    created_at: number;
    family_name: string;
    registration_students_id: number[];
    registration_parents_id: number[];
    registration_emergency_contacts_id: number[];
  } | null;
}

/** Bridge row: one per family per school year, covering the RE-APPLICATION
 *  flow for returning families. Tracks the four section bools the parent
 *  needs to refresh when applying for a new academic year — most notably
 *  the per-year Opportunity Scholarship application. Family + student
 *  records carry over; only these four sections need parent confirmation
 *  for a re-applying family.
 *
 *  Distinct from `registration_family_application_progress` because the
 *  section list differs (no Initial Testing, adds Transportation) and the
 *  admin can independently track which families are re-applying vs.
 *  applying for the first time. */
export interface XanoReapplyFamilyProgress {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  /** Parent acknowledged the existing family info for the new year. */
  isFamilyDetails: boolean;
  /** Parent acknowledged the existing student info for the new year. */
  isStudentDetails: boolean;
  /** Parent submitted the per-year Opportunity Scholarship application. */
  isScholarship: boolean;
  /** Parent confirmed bus / transportation preferences for the new year. */
  isTransportation: boolean;
  /** Hard submission latch — flips true when the parent clicks Submit on
   *  the re-application review modal. */
  isSubmitted: boolean;
  last_edited: number | null;
}

/** Bridge row: one per family per school year, covering the POST-acceptance
 *  registration flow. Mirrors the application-progress pattern but lives in a
 *  separate table so the two lifecycle stages stay cleanly split. Three
 *  section bools map 1:1 to the three registration step pages: tuition,
 *  enrollment-signing, and registration. `submitted_date` is the latch
 *  timestamp stamped when all three sections are complete. */
export interface XanoStudentRegistrationProgress {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  registration_type_id: number;
  /** Parent reviewed and accepted the tuition schedule on /tuition */
  isTuition: boolean;
  /** Enrollment agreement signed + first payment completed (the
   *  /enrollment-signing step) */
  isEnrollment: boolean;
  /** Student registration packet — medical, emergency contacts, etc. — done
   *  on /registration */
  isRegistration: boolean;
  /** Parent acknowledged the mandatory volunteer-hours commitment (40/year,
   *  8 per term over 5 academic terms) on /volunteer-hours. */
  isVolunteerHours: boolean;
  /** Uploaded signature image for the volunteer-hours acknowledgment — Xano
   *  file metadata (path/url/mime/size). */
  signature_data_volunteer: Record<string, unknown> | null;
  /** Raw signature payload for the volunteer acknowledgment (timestamp,
   *  draw metadata, etc.). Printed name lives on `name_volunteer` below. */
  volunteer_signature_data: Record<string, unknown> | null;
  /** Printed name typed by the parent on the volunteer-hours
   *  acknowledgment page. Parallel to `name` on the tuition step. */
  name_volunteer: string;
  /** Family-level signature captured on /tuition when the parent acknowledges
   *  the tuition + scholarship breakdown. Shape matches Xano's file metadata:
   *  `{ path, url, mime, size, meta, ... }`. Null before the signature lands. */
  tuition_scholarship_signature: Record<string, unknown> | null;

  // --- Family billing + enrollment-agreement fields -----------------------
  // All family-level (one per family per year). Absorbed from the retired
  // `registration_families_payment` table so we have a single row to read
  // and write for the registration lifecycle.
  monthly_tuition_payment: number;
  monthly_transportation_payment: number;
  enrollment_agreement_pandadoc_id: string;
  enrollment_agreement_status: string;
  /** When the enrollment agreement was sent (ISO string or epoch ms). */
  enrollment_agreement_sent: string | number | null;
  enrollment_agreement_pdf_url: string;
  is_enrollment_agreement_signed: boolean;
  /** Legacy raw signature data carried forward from families_payment. */
  signature_data: Record<string, unknown> | null;
  /** Printed name on the tuition acknowledgement. */
  name: string;

  last_edited: number | null;
  /** Timestamp stamped when all three section bools are true. */
  submitted_date: number | null;
  /** Hard submission flag — true once the parent has clicked Submit on the
   *  final registration review. `submitted_date` is the timestamp; this is
   *  the durable bool the enrolled-family dashboard reads to decide whether
   *  to render the active registration flow or the post-enrollment view. */
  isSubmitted: boolean;

  // ── Admin section-verify pairs ─────────────────────────────────
  // Three columns per section: a bool flag + audit timestamp + audit
  // admin name string. Admin clicks "Verify <Section>" on the
  // registration detail page — we flip the bool true, stamp
  // `Date.now()` on `*_admin_confirm_time`, and stamp the admin's
  // display name on `*_admin_confirm_admin`. Approach B: when the
  // parent edits any data belonging to that section (i.e. flips the
  // matching `isXxx` parent-completion bool back to false), the
  // verify pair auto-clears.
  //
  // Mirrors the audit pattern on
  // `registration_family_application_progress` for the apply-flow
  // section confirms. Three sections track admin verification on
  // this row: Tuition, Enrollment, Volunteer Hours. The Registration
  // Packet section's confirmation is per-student (lives on
  // `registration_student_registration.registrationConfirmed`), so
  // there's no `registration_admin_confirm*` triplet here.
  tuition_admin_confirm?: boolean;
  tuition_admin_confirm_time?: number | null;
  tuition_admin_confirm_admin?: string;
  enrollment_admin_confirm?: boolean;
  enrollment_admin_confirm_time?: number | null;
  enrollment_admin_confirm_admin?: string;
  volunteer_admin_confirm?: boolean;
  volunteer_admin_confirm_time?: number | null;
  volunteer_admin_confirm_admin?: string;
  /** Emergency-contacts section verify triplet. No matching parent-
   *  completion bool exists for this section (emergency contacts are
   *  family-evergreen — they exist or they don't, with no in-progress
   *  state), so the verify→complete cascade other sections use is
   *  skipped here. */
  emergency_contacts_admin_confirm?: boolean;
  emergency_contacts_admin_confirm_time?: number | null;
  emergency_contacts_admin_confirm_admin?: string;
}

export interface XanoEmergencyContact {
  id: number;
  created_at: number;
  registration_families_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

export interface XanoStudentRegistration {
  id: number;
  created_at: number;
  registration_students_id: number;
  /** Year this packet belongs to. Packets are per (student, year); a fresh
   *  row is created each year so historical data stays intact. */
  registration_school_years_id: number;
  /** New Enrollment vs Re-Enrollment — admin-set, drives which forms/templates
   *  get used for this year's registration. */
  registration_type_id: number;
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  birth_certificate: Record<string, unknown>;
  school_health_form: Record<string, unknown>;
  transcripts: Record<string, unknown>;
  iep: Record<string, unknown>;
  ssn_card: Record<string, unknown>;
  immunization_forms: Record<string, unknown>;
  passport: Record<string, unknown>;
  immunization_form: Record<string, unknown>;
  student_state_id: Record<string, unknown>;
  allergies: string;
  iep_description: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  is_student_on_medicaid: boolean;
  medicaid_number: number;
  medicaid_provider: string;
  carry_epi_pen: boolean;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
  liability_waiver_pandadoc_id: string;
  liability_waiver_status: string;
  liability_waiver_sent_at: string | null;
  liability_waiver_pdf_url: string;
  /** Admin-set flag — flips true when the admissions team has reviewed
   *  and confirmed this student's registration. The enrolled-family
   *  dashboard only unlocks once every student on the family for a given
   *  year has this set.
   *
   *  Note: the canonical "is this student verified?" flag now lives on
   *  the student row as `is_verified` (one source of truth across
   *  multi-year packets). This per-packet flag stays for backward
   *  compatibility with legacy data + parent-side dashboard reads. */
  registrationConfirmed: boolean;
  /** Audit timestamp + admin name for `registrationConfirmed`.
   *  Optional because the columns were added after launch — note the
   *  `regisration_*` typo on the second column matches the live Xano
   *  schema and shouldn't be "corrected" client-side. */
  registration_confirmed_admin_time?: number | null;
  regisration_admin_confirmed_admin?: string;
  /** Last-edited timestamp on the packet row. Bumped whenever any
   *  admin or parent write changes the row; useful for audit /
   *  staleness checks alongside the parallel `last_edited_time` on
   *  the student row. */
  last_edited_time?: number | null;
  /** Legacy / Xano-side mirror of `last_edited_time`. Some rows
   *  carry both columns; we don't write `last_updated` from this
   *  codebase but include it on the type so reads don't lose
   *  information. */
  last_updated?: number | null;
  /** Addon: when the GET endpoint includes the `registration_students`
   *  row inline, it surfaces as `_registration_students_2`. Optional
   *  because list endpoints / filtered queries may not include it.
   *  Used by the per-student verify cascade to skip a separate
   *  `students.getById` hop. */
  _registration_students_2?: XanoStudent;
}

const pendingEnsure = new Map<string, Promise<XanoParent>>();

/**
 * In-flight `resolve()` calls for the two per-year progress tables.
 * Keyed by `${tableTag}:${familyId}:${yearId}` so a single Node
 * process collapses concurrent first-time creates into one Xano
 * `POST` instead of racing past the "exists?" check. Cross-process
 * races (multiple Next.js instances behind a load balancer, or this
 * server + a Xano webhook handler) still need the post-create
 * dedupe inside `_doResolveProgress` — but in single-instance dev
 * and most production deployments this mutex alone collapses 99% of
 * the dupe-creating races.
 */
const pendingProgressResolve = new Map<
  string,
  Promise<XanoStudentRegistrationProgress | XanoFamilyApplicationProgress>
>();

/**
 * Shared post-create dedupe used by both progress tables' `resolve()`
 * methods. After our create lands we re-query to see if a parallel
 * caller (different process / webhook firing at the same time) also
 * created a row for this `(family, year)`. If multiple exist, the
 * most-recently-edited row wins (id-asc tiebreaker, deterministic
 * across processes); the losers get hard-deleted so future reads
 * converge on a single row.
 *
 * Edits are merged into the keeper before deletion: if a loser has
 * a non-empty value where the keeper is empty (e.g. parent flipped
 * `isTuition=true` on the loser before we noticed), we copy that
 * value across so we never lose progress to dedupe. Boolean true,
 * non-zero numbers, non-empty strings, and non-null objects all
 * count as "non-empty" — see `mergeProgressFields` for the exact
 * predicate.
 *
 * If the dedupe fails (e.g. Xano DELETE 5xx) we surface a warning
 * and return the keeper anyway — the next `resolve()` will retry
 * the cleanup.
 */
async function dedupeProgressRows<
  T extends {
    id: number;
    created_at?: number;
    last_edited: number | null;
  },
>(
  matches: T[],
  tableTag: string,
  deleteFn: (id: number) => Promise<void>,
  updateFn: (id: number, patch: Partial<T>) => Promise<T>
): Promise<T> {
  if (matches.length === 1) return matches[0];

  // Sort: last_edited desc, id asc — deterministic so every caller
  // converges on the same keeper.
  const sorted = matches.slice().sort((a, b) => {
    const aEdit = a.last_edited ?? a.created_at ?? 0;
    const bEdit = b.last_edited ?? b.created_at ?? 0;
    if (aEdit !== bEdit) return bEdit - aEdit;
    return a.id - b.id;
  });
  const keeper = sorted[0];
  const losers = sorted.slice(1);

  console.warn(
    `[${tableTag}.resolve] ${matches.length} duplicate rows detected; keeping id=${keeper.id} and deleting ${losers
      .map((l) => l.id)
      .join(",")}`
  );

  // Merge any non-empty fields from losers into the keeper so dedupe
  // can't lose data.
  const merged = mergeProgressFields(keeper, losers);
  const mergedKeys = Object.keys(merged);
  let final = keeper;
  if (mergedKeys.length > 0) {
    try {
      final = await updateFn(keeper.id, merged as Partial<T>);
    } catch (err) {
      console.warn(
        `[${tableTag}.resolve] merge into keeper id=${keeper.id} failed:`,
        err
      );
    }
  }

  // Delete the losers in parallel — failures don't block the
  // resolve (the next call will retry).
  await Promise.allSettled(
    losers.map((l) =>
      deleteFn(l.id).catch((err) => {
        console.warn(
          `[${tableTag}.resolve] delete of loser id=${l.id} failed:`,
          err
        );
      })
    )
  );

  return final;
}

/**
 * Return the subset of fields from `losers` that should be copied
 * onto `keeper` because the keeper's value is empty. Used by the
 * post-create dedupe to make sure parent-flipped flags aren't lost
 * when the row that received the flip happens to be the row we're
 * about to delete.
 *
 * Predicate: a value is "non-empty" if it's `true`, a non-zero
 * number, a non-empty string, or a non-null object/array. `false` /
 * `0` / `""` / `null` / `undefined` all count as empty so legitimate
 * defaults don't override real data on the keeper.
 */
function mergeProgressFields<T extends Record<string, unknown>>(
  keeper: T,
  losers: T[]
): Partial<T> {
  const result: Record<string, unknown> = {};
  // Skip the columns Xano owns or that are scoped to the row's
  // identity — copying these would cause a self-overwrite or break
  // foreign-key invariants.
  const SKIP = new Set([
    "id",
    "created_at",
    "registration_families_id",
    "registration_school_years_id",
    "last_edited",
  ]);
  const isNonEmpty = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v === true;
    if (typeof v === "number") return v !== 0 && Number.isFinite(v);
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return false;
  };
  // Walk every key the keeper or any loser knows about so we don't
  // miss columns absent on the keeper.
  const allKeys = new Set<string>();
  for (const k of Object.keys(keeper)) allKeys.add(k);
  for (const l of losers) for (const k of Object.keys(l)) allKeys.add(k);
  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    const keeperVal = (keeper as Record<string, unknown>)[key];
    if (isNonEmpty(keeperVal)) continue;
    // Find the first loser with a non-empty value for this column.
    const winner = losers.find((l) =>
      isNonEmpty((l as Record<string, unknown>)[key])
    );
    if (winner) {
      result[key] = (winner as Record<string, unknown>)[key];
    }
  }
  return result as Partial<T>;
}

export function ensureParentRecord(
  clerkUserId: string,
  clerkUser: {
    firstName?: string | null;
    lastName?: string | null;
    primaryEmailAddress?: { emailAddress: string } | null;
    primaryPhoneNumber?: { phoneNumber: string } | null;
  }
): Promise<XanoParent> {
  const inflight = pendingEnsure.get(clerkUserId);
  if (inflight) return inflight;

  const promise = _doEnsureParentRecord(clerkUserId, clerkUser).finally(() => {
    pendingEnsure.delete(clerkUserId);
  });
  pendingEnsure.set(clerkUserId, promise);
  return promise;
}

async function _doEnsureParentRecord(
  clerkUserId: string,
  clerkUser: {
    firstName?: string | null;
    lastName?: string | null;
    primaryEmailAddress?: { emailAddress: string } | null;
    primaryPhoneNumber?: { phoneNumber: string } | null;
  }
): Promise<XanoParent> {
  const email = clerkUser.primaryEmailAddress?.emailAddress ?? "";
  const rawPhone = clerkUser.primaryPhoneNumber?.phoneNumber ?? "";
  const cleanPhone = rawPhone.replace(/\D/g, "");

  const existing = await xano.parents.findByClerkId(clerkUserId);
  if (existing) {
    const updates: Partial<Omit<XanoParent, "id" | "created_at">> = {};
    if (clerkUser.firstName && clerkUser.firstName !== existing.first_name)
      updates.first_name = clerkUser.firstName;
    if (clerkUser.lastName && clerkUser.lastName !== existing.last_name)
      updates.last_name = clerkUser.lastName;
    if (email && email !== existing.email) updates.email = email;
    if (cleanPhone && cleanPhone !== existing.phone)
      updates.phone = cleanPhone;

    if (Object.keys(updates).length > 0) {
      return await xano.parents.update(existing.id, updates);
    }
    return existing;
  }

  const pendingParent = email ? await xano.parents.findByEmail(email) : null;

  if (pendingParent && pendingParent.invite_status === "pending") {
    return await xano.parents.update(pendingParent.id, {
      clerk_user_id: clerkUserId,
      first_name: clerkUser.firstName ?? pendingParent.first_name,
      last_name: clerkUser.lastName ?? pendingParent.last_name,
      phone: cleanPhone || pendingParent.phone,
      invite_status: "active",
    });
  }

  return await xano.parents.create({
    clerk_user_id: clerkUserId,
    first_name: clerkUser.firstName ?? "",
    last_name: clerkUser.lastName ?? "",
    email,
    phone: cleanPhone,
    relationship: "",
    invite_status: "active",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    zipcode: "",
  });
}

/**
 * Normalize a contributing-member row's primary key. Xano sometimes
 * exposes the PK under a custom column name
 * (`registration_opportunity_scholarship_contributing_members_id`)
 * — typically when the table's PK has been renamed in the schema
 * editor or when the row is fetched through certain join shapes.
 * Callers in this codebase universally read `id`; this helper
 * promotes the custom column into `id` when the standard one is
 * missing, so a Xano-side rename doesn't silently break the parent
 * flow's PATCH/DELETE round-trips.
 *
 * Defensive on shape — accepts any object and returns it cast to
 * `XanoScholarshipContributingMember`. The cast is safe because all
 * other fields on the type are read defensively at the call sites.
 */
function normalizeContributingMemberPK(
  raw: Record<string, unknown>
): XanoScholarshipContributingMember {
  const out = { ...raw };
  if (
    (out.id === undefined || out.id === null) &&
    typeof out.registration_opportunity_scholarship_contributing_members_id ===
      "number"
  ) {
    out.id =
      out.registration_opportunity_scholarship_contributing_members_id;
  }
  return out as unknown as XanoScholarshipContributingMember;
}

export const xano = {
  parents: {
    async create(data: Omit<XanoParent, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_parents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoParent>;
    },

    async getAll(): Promise<XanoParent[]> {
      const res = await fetch(`${getBaseUrl()}/registration_parents`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoParent> {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoParent, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoParent>;
    },

    async findByClerkId(clerkUserId: string): Promise<XanoParent | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_parents?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          // Fallback to full scan if query param not supported
          const all = await this.getAll();
          return all.find((p) => p.clerk_user_id === clerkUserId) ?? null;
        }
        const results: XanoParent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((p) => p.clerk_user_id === clerkUserId) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((p) => p.clerk_user_id === clerkUserId) ?? null;
      }
    },

    async findByEmail(email: string): Promise<XanoParent | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_parents?email=${encodeURIComponent(email)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((p) => p.email === email) ?? null;
        }
        const results: XanoParent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((p) => p.email === email) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((p) => p.email === email) ?? null;
      }
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  families: {
    async create(data: Omit<XanoFamily, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_families`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoFamily>;
    },

    async getAll(): Promise<XanoFamily[]> {
      const res = await fetch(`${getBaseUrl()}/registration_families`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /**
     * Enriched view of every family — Xano expands the
     * `registration_students_id` and `registration_parents_id` arrays into
     * full row objects (applications and parents respectively). Ideal for
     * the admin tables which need a single fetch instead of N+1.
     *
     * The Xano relationship expansion sometimes inserts empty `[]` items
     * inside those arrays for unresolved FKs — we strip them here so
     * downstream code can iterate without type guards.
     */
    async getAllDetails(): Promise<XanoFamilyAllDetails[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_all_details`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = await res.json();
      if (!Array.isArray(raw)) return [];
      return raw.map(cleanFamilyAllDetails);
    },

    async getById(id: number): Promise<XanoFamily> {
      const res = await fetch(`${getBaseUrl()}/registration_families/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoFamily, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_families/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoFamily>;
    },

    async findByParentId(parentId: number): Promise<XanoFamily | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_families?registration_parents_id=${parentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
        }
        const results: XanoFamily[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
      }
    },

    getParentIds(family: XanoFamily): number[] {
      return extractIds(family.registration_parents_id);
    },

    getEmbeddedParents(family: XanoFamily): XanoParent[] {
      return extractParents(family.registration_parents_id);
    },

    getStudentIds(family: XanoFamily): number[] {
      return extractIds(family.registration_students_id);
    },
  },

  students: {
    async create(data: Omit<XanoStudent, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoStudent>;
    },

    async getAll(): Promise<XanoStudent[]> {
      const res = await fetch(`${getBaseUrl()}/registration_students`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoStudent> {
      const res = await fetch(`${getBaseUrl()}/registration_students/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoStudent, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_students/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoStudent>;
    },

    async getByFamilyId(familyId: number): Promise<XanoStudent[]> {
      // Sorted by id ASC = creation order so a newly-added student
      // lands at the end of the list rather than floating to the
      // top. Matches the parallel sort on `applications.getByFamilyId`
      // — the students page indexes both arrays by student id, so
      // their orders need to agree for the rendered list to look
      // right.
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_students?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all
            .filter((s) => s.registration_families_id === familyId && !s.isArchived)
            .sort((a, b) => a.id - b.id);
        }
        const results: XanoStudent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items
          .filter((s) => s.registration_families_id === familyId && !s.isArchived)
          .sort((a, b) => a.id - b.id);
      } catch {
        const all = await this.getAll();
        return all
          .filter((s) => s.registration_families_id === familyId && !s.isArchived)
          .sort((a, b) => a.id - b.id);
      }
    },
  },

  applications: {
    async create(data: Omit<XanoApplication, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_application`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoApplication>;
    },

    /**
     * Admin-only — single fetch that returns every piece of data the
     * admin family-detail page needs to render the per-student
     * application breakdown:
     *   - `application[]` — one row per student for the year
     *   - `scholarship[]` — the family's Opportunity Scholarship row(s)
     *     for the year (typically zero or one)
     *   - `family` — the family record (parents/students/contacts as IDs)
     *   - `school_year` — the matching school-year metadata
     *
     * Backed by the Xano `admin_family_application` query with two
     * inputs: `registration_families_id` and `registration_school_years_id`.
     */
    async getAdminFamilyDetail(
      familyId: number,
      yearId: number
    ): Promise<XanoAdminFamilyDetail | null> {
      try {
        const url = new URL(`${getBaseUrl()}/admin_family_application`);
        url.searchParams.set(
          "registration_families_id",
          String(familyId)
        );
        url.searchParams.set(
          "registration_school_years_id",
          String(yearId)
        );
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as XanoAdminFamilyDetail;
      } catch {
        return null;
      }
    },

    async getAll(): Promise<XanoApplication[]> {
      const res = await fetch(`${getBaseUrl()}/registration_application`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoApplication> {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoApplication, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoApplication>;
    },

    async getByFamilyId(familyId: number): Promise<XanoApplication[]> {
      // Result is sorted by id ASC so a newly-added student lands at
      // the END of the list, not the top — matches the parent's
      // mental model on the apply-flow students page ("the kid I
      // just added is the last one"). Xano's filtered GETs don't
      // guarantee a deterministic order, so without this sort the
      // students page (and other surfaces that index `applications[0]`
      // as "the family's first student", like the waiver flow) would
      // behave inconsistently across reloads.
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all
            .filter((a) => a.registration_families_id === familyId)
            .sort((a, b) => a.id - b.id);
        }
        const results: XanoApplication[] = await res.json();
        return Array.isArray(results)
          ? results.slice().sort((a, b) => a.id - b.id)
          : [];
      } catch {
        const all = await this.getAll();
        return all
          .filter((a) => a.registration_families_id === familyId)
          .sort((a, b) => a.id - b.id);
      }
    },

    async getByStudentAndYear(studentId: number, schoolYearId: number): Promise<XanoApplication | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_students_id=${studentId}&registration_school_years_id=${schoolYearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find(
            (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
          ) ?? null;
        }
        const results: XanoApplication[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find(
          (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
        ) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find(
          (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
        ) ?? null;
      }
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  applicationStatuses: {
    async getAll(): Promise<XanoApplicationStatus[]> {
      const res = await fetch(`${getBaseUrl()}/registration_application_status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoApplicationStatus> {
      const res = await fetch(`${getBaseUrl()}/registration_application_status/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async findByName(name: string): Promise<XanoApplicationStatus | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application_status?status_name=${encodeURIComponent(name)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
        }
        const results: XanoApplicationStatus[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
      }
    },
  },

  schoolYears: {
    async getAll(): Promise<XanoSchoolYear[]> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoSchoolYear> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async create(
      data: Omit<XanoSchoolYear, "id" | "created_at">
    ): Promise<XanoSchoolYear> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<Omit<XanoSchoolYear, "id" | "created_at">>
    ): Promise<XanoSchoolYear> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /**
   * Per-year scholarship award matrix. One row = one cell at
   * (household_size × income_bracket). The admin matrix editor reads
   * `getByYear` on mount, then PATCHes individual cells as they're
   * edited. Adding a household-size row or income-bracket column means
   * inserting one new row per existing column / row respectively.
   */
  schoolYearAwardBrackets: {
    async getByYear(yearId: number): Promise<XanoSchoolYearAwardBracket[]> {
      const url = new URL(
        `${getBaseUrl()}/registration_school_year_award_brackets`
      );
      url.searchParams.set(
        "registration_school_years_id",
        String(yearId)
      );
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        // Return [] instead of throwing on 404/empty-table so a freshly
        // configured year (with no matrix yet) renders an empty grid
        // rather than a hard error.
        if (res.status === 404) return [];
        throw new Error(
          `Xano error ${res.status}: ${await res.text()}`
        );
      }
      const items = await res.json();
      return Array.isArray(items) ? items : [];
    },

    async create(
      data: Omit<XanoSchoolYearAwardBracket, "id" | "created_at">
    ): Promise<XanoSchoolYearAwardBracket> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_award_brackets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<
        Omit<XanoSchoolYearAwardBracket, "id" | "created_at">
      >
    ): Promise<XanoSchoolYearAwardBracket> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_award_brackets/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_award_brackets/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /**
   * Per-year "high net assets" matrix. Same shape as the award
   * brackets above, but cell values are percentages of total tuition
   * (0–100), not dollar amounts. Backed by the
   * `registration_school_year_net_assets_bracket` Xano table.
   */
  schoolYearNetAssetsBrackets: {
    async getByYear(
      yearId: number
    ): Promise<XanoSchoolYearNetAssetsBracket[]> {
      const url = new URL(
        `${getBaseUrl()}/registration_school_year_net_assets_bracket`
      );
      url.searchParams.set(
        "registration_school_years_id",
        String(yearId)
      );
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      const items = await res.json();
      return Array.isArray(items) ? items : [];
    },

    async create(
      data: Omit<XanoSchoolYearNetAssetsBracket, "id" | "created_at">
    ): Promise<XanoSchoolYearNetAssetsBracket> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_net_assets_bracket`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<
        Omit<XanoSchoolYearNetAssetsBracket, "id" | "created_at">
      >
    ): Promise<XanoSchoolYearNetAssetsBracket> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_net_assets_bracket/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_school_year_net_assets_bracket/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok)
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  scholarship: {
    async create(data: Omit<XanoScholarship, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarship>;
    },

    async getAll(): Promise<XanoScholarship[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoScholarship> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarship, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarship>;
    },

    async getByFamilyAndYear(familyId: number, yearId: number): Promise<XanoScholarship | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find(
            (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
          ) ?? null;
        }
        const results: XanoScholarship[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find(
          (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
        ) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find(
          (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
        ) ?? null;
      }
    },
  },

  scholarshipBenefits: {
    async create(data: Omit<XanoScholarshipBenefit, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipBenefit>;
    },

    async getAll(): Promise<XanoScholarshipBenefit[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipBenefit, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipBenefit>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipBenefit[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_benefits?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((b) => b.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipBenefit[] = await res.json();
        // Always filter client-side — Xano's auto GET doesn't honor
        // arbitrary FK params so a 200 response can include every
        // benefit in the table. Same reason the contributing-members
        // helper filters here too.
        return Array.isArray(results)
          ? results.filter(
              (b) =>
                b.registration_opportunity_scholarship_id === scholarshipId
            )
          : [];
      } catch {
        const all = await this.getAll();
        return all.filter((b) => b.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipContributingMembers: {
    async create(data: Omit<XanoScholarshipContributingMember, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      // Xano sometimes exposes the table's primary key under a custom
      // column name (e.g. `registration_opportunity_scholarship_contributing_members_id`)
      // when the row is fetched through certain join paths or after a
      // PK rename in the schema editor. Normalize so callers can keep
      // reading `id` regardless of which column name comes back —
      // missing this would leave the parent flow's
      // `setMembers([...members, created])` with an undefined `id`,
      // which would silently break every subsequent PATCH/DELETE.
      const raw = (await res.json()) as Record<string, unknown>;
      return normalizeContributingMemberPK(raw);
    },

    async getAll(): Promise<XanoScholarshipContributingMember[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>[];
      return Array.isArray(raw) ? raw.map(normalizeContributingMemberPK) : [];
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipContributingMember, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>;
      return normalizeContributingMemberPK(raw);
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipContributingMember[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_contributing_members?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((m) => m.registration_opportunity_scholarship_id === scholarshipId);
        }
        const raw = (await res.json()) as Record<string, unknown>[];
        const normalized = Array.isArray(raw)
          ? raw.map(normalizeContributingMemberPK)
          : [];
        // ALWAYS filter client-side — Xano's auto-generated GET on
        // a child table treats query params as auxiliary filters, not
        // as the listing predicate. When the param is something Xano
        // doesn't recognize as a built-in (e.g. just the FK column
        // name), the response is the FULL table — every contributing
        // member for every scholarship in the system. Without this
        // filter, the admin Financial Aid view would surface other
        // families' members.
        return normalized.filter(
          (m) =>
            m.registration_opportunity_scholarship_id === scholarshipId
        );
      } catch {
        const all = await this.getAll();
        return all.filter((m) => m.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipHomes: {
    async create(data: Omit<XanoScholarshipHome, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipHome>;
    },

    async getAll(): Promise<XanoScholarshipHome[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipHome, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipHome>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipHome[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_home?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((h) => h.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipHome[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((h) => h.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipVehicles: {
    async create(data: Omit<XanoScholarshipVehicle, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipVehicle>;
    },

    async getAll(): Promise<XanoScholarshipVehicle[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipVehicle, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipVehicle>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipVehicle[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_vehicles?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((v) => v.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipVehicle[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((v) => v.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  busStops: {
    async getAll(): Promise<XanoBusStop[]> {
      const res = await fetch(`${getBaseUrl()}/registration_bus`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  familyPayments: {
    async getByFamilyAndYear(familyId: number, yearId: number): Promise<XanoFamilyPayment | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_families_payment?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [results];
        return items.find(
          (p: XanoFamilyPayment) =>
            p.registration_families_id === familyId &&
            p.registration_school_years_id === yearId
        ) ?? null;
      } catch {
        return null;
      }
    },

    async create(data: Omit<XanoFamilyPayment, "id" | "created_at">): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoFamilyPayment, "id" | "created_at">>): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  emergencyContacts: {
    async create(data: Omit<XanoEmergencyContact, "id" | "created_at">): Promise<XanoEmergencyContact> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getByFamilyId(familyId: number): Promise<XanoEmergencyContact[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_emergency_contacts?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        return Array.isArray(results) ? results.filter((c: XanoEmergencyContact) => c.registration_families_id === familyId) : [];
      } catch {
        return [];
      }
    },

    async update(id: number, data: Partial<Omit<XanoEmergencyContact, "id" | "created_at">>): Promise<XanoEmergencyContact> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  studentRegistration: {
    async create(data: Omit<XanoStudentRegistration, "id" | "created_at">): Promise<XanoStudentRegistration> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getByStudentId(studentId: number): Promise<XanoStudentRegistration | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration?registration_students_id=${studentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        const match = items.find((r: XanoStudentRegistration) => r.registration_students_id === studentId);
        return match ?? null;
      } catch {
        return null;
      }
    },

    /**
     * Year-scoped variant of `getByStudentId`. The packet table is
     * (student, year) — a student can have packets across multiple
     * years for re-enrollment — so callers that care about the
     * current year's packet need to filter explicitly. Used by the
     * PandaDoc waiver flows (which now write to this table) and the
     * waiver download ownership check.
     */
    async getByStudentAndYear(
      studentId: number,
      yearId: number
    ): Promise<XanoStudentRegistration | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration?registration_students_id=${studentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        const match = items.find(
          (r: XanoStudentRegistration) =>
            r.registration_students_id === studentId &&
            Number(r.registration_school_years_id) === yearId
        );
        return match ?? null;
      } catch {
        return null;
      }
    },

    /**
     * Fetch-or-create the per (student, year) packet. Used by the
     * PandaDoc waiver routes since waiver state lives on the packet
     * but a parent may trigger the waiver before they've started
     * filling out the rest of the registration form — in which case
     * a minimal packet needs to exist for the waiver fields to land
     * on. Defaults mirror the empty-row shape Xano expects on a
     * fresh POST.
     *
     * `registration_type_id` defaults to `1` (new enrollment) since
     * that's the apply-flow default; pass an explicit value when
     * resolving for a re-enrollment cycle.
     */
    async resolve(
      studentId: number,
      yearId: number,
      registration_type_id: number = 1
    ): Promise<XanoStudentRegistration> {
      const existing = await this.getByStudentAndYear(studentId, yearId);
      if (existing) return existing;
      return this.create({
        registration_students_id: studentId,
        registration_school_years_id: yearId,
        registration_type_id,
        shirt_size: "",
        pant_size: "",
        swim_level: "",
        birth_certificate: {},
        school_health_form: {},
        transcripts: {},
        iep: {},
        ssn_card: {},
        immunization_forms: {},
        passport: {},
        immunization_form: {},
        student_state_id: {},
        allergies: "",
        iep_description: "",
        dietary_restrictions: "",
        prescription_medications: "",
        health_conditions: "",
        vision_impairments: "",
        hearing_impairments: "",
        is_student_on_medicaid: false,
        medicaid_number: 0,
        medicaid_provider: "",
        carry_epi_pen: false,
        epipen_explainer: "",
        permission_for_acetaminophen: "",
        additional_health_information: "",
        interested_in_counseling_services: "",
        other_adults_approved_for_pickup: "",
        prohibited_adults: "",
        liability_waiver_pandadoc_id: "",
        liability_waiver_status: "",
        liability_waiver_sent_at: null,
        liability_waiver_pdf_url: "",
        registrationConfirmed: false,
      });
    },

    /**
     * Pull every per-student registration packet for an academic year.
     *
     * Backs the admin Enrolled Students list (filtered to
     * `registrationConfirmed=true`) and the family-level registration
     * detail page (one row per active student in the family). We
     * fetch all packets and filter client-side because the underlying
     * Xano table doesn't expose a cheap "by year" index — calls are
     * cached `no-store` so admin always sees fresh state. Errors are
     * logged and `[]` is returned so a transient Xano blip doesn't
     * 500 the surface that depends on this list.
     */
    async getByYear(yearId: number): Promise<XanoStudentRegistration[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[xano.studentRegistration.getByYear] ${res.status} for yearId=${yearId}: ${body}`
          );
          return [];
        }
        const items: XanoStudentRegistration[] = await res.json();
        return Array.isArray(items)
          ? items.filter(
              (r) => Number(r.registration_school_years_id) === yearId
            )
          : [];
      } catch (err) {
        console.error(
          `[xano.studentRegistration.getByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    async update(
      id: number,
      data: Partial<Omit<XanoStudentRegistration, "id" | "created_at">>
    ): Promise<XanoStudentRegistration> {
      // Always stamp `last_edited_time` to reflect the most recent
      // write — applies to every caller (parent flow, admin
      // verification, PandaDoc webhooks, etc.) so the staleness
      // surfaces (admin enrolled-detail "Last edited 3 days ago",
      // etc.) stay honest without each call site remembering to
      // set it. Caller-supplied values are intentionally
      // overridden — the source of truth is "right now".
      const body = { ...data, last_edited_time: Date.now() };
      const res = await fetch(`${getBaseUrl()}/registration_student_registration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    /**
     * Enriched fetch — pulls packet + school year + registration type +
     * student row in a single Xano call. Required input on the Xano side
     * is `registration_student_registration_id`, which is just the
     * packet's primary key.
     */
    async getDetailsById(packetId: number): Promise<XanoRegistrationDetails | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration_details`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_student_registration_id: packetId,
            }),
            cache: "no-store",
          }
        );
        if (!res.ok) return null;
        return (await res.json()) as XanoRegistrationDetails;
      } catch {
        return null;
      }
    },
  },

  adminNotes: {
    /** All notes for a family, newest first. Pinned notes still appear in
     *  the same list — sorting/grouping happens in the UI. */
    async getByFamilyId(familyId: number): Promise<XanoAdminNote[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_admin_notes?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const items: XanoAdminNote[] = await res.json();
        return Array.isArray(items)
          ? items
              .filter((n) => n.registration_families_id === familyId)
              // Family notes only — inquiry-scoped notes share the
              // same table but live on a different foreign key. Filter
              // them out so a stray match (e.g. shared ids across
              // tables) doesn't bleed into the family timeline.
              .filter(
                (n) =>
                  n.registration_inquiry_id === null ||
                  n.registration_inquiry_id === undefined
              )
              .sort((a, b) => b.created_at - a.created_at)
          : [];
      } catch {
        return [];
      }
    },

    /**
     * Registration-phase notes only, scoped to a single (family,
     * year). Backed by the dedicated Xano query
     * `registration_admin_notes_by_registration` — server-side filter
     * is supposed to narrow to notes tagged with this family/year's
     * `registration_student_registration_progress_id`, which is the
     * FK the registration detail page stamps on every note it
     * composes.
     *
     * Belt-and-braces filter on the client too: we only keep notes
     * whose `registration_student_registration_progress_id` is
     * actually set (non-null + non-zero). Without this guard, if the
     * Xano endpoint returns broadly (e.g. all family/year notes
     * regardless of FK), apply-phase notes would leak into the
     * registration detail page's drawer. The frontend filter makes
     * the contract explicit: registration drawer = only notes
     * tagged for the registration phase.
     *
     * Used by the family registration detail page's notes drawer so
     * admin only sees registration-phase comms in that surface, not
     * the full apply-phase history. The unified family-wide drawer
     * still uses `getByFamilyId` to show everything.
     *
     * Errors return [] silently — the drawer renders a "no notes
     * yet" empty state when this happens, which is the same UX as
     * a real empty timeline.
     */
    async getByFamilyAndYearForRegistration(
      familyId: number,
      yearId: number
    ): Promise<XanoAdminNote[]> {
      try {
        const url = new URL(
          `${getBaseUrl()}/registration_admin_notes_by_registration`
        );
        url.searchParams.set("registration_families_id", String(familyId));
        url.searchParams.set("registration_school_years_id", String(yearId));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[xano.adminNotes.getByFamilyAndYearForRegistration] ${res.status} for family=${familyId} year=${yearId}: ${body}`
          );
          return [];
        }
        const items = await res.json();
        if (!Array.isArray(items)) return [];
        return items
          .filter((n: XanoAdminNote) => {
            const id = n.registration_student_registration_progress_id;
            return id != null && id !== 0;
          })
          .slice()
          .sort(
            (a: XanoAdminNote, b: XanoAdminNote) =>
              b.created_at - a.created_at
          );
      } catch (err) {
        console.error(
          `[xano.adminNotes.getByFamilyAndYearForRegistration] threw for family=${familyId} year=${yearId}:`,
          err
        );
        return [];
      }
    },

    /** Inquiry-scoped variant. Same table, filtered to rows whose
     *  `registration_inquiry_id` matches. Mutually exclusive with the
     *  family timeline above — a single note is tied to one or the
     *  other, not both. */
    async getByInquiryId(inquiryId: number): Promise<XanoAdminNote[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_admin_notes?registration_inquiry_id=${inquiryId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const items: XanoAdminNote[] = await res.json();
        return Array.isArray(items)
          ? items
              .filter((n) => n.registration_inquiry_id === inquiryId)
              .sort((a, b) => b.created_at - a.created_at)
          : [];
      } catch {
        return [];
      }
    },

    async create(
      data: Omit<XanoAdminNote, "id" | "created_at" | "last_edited"> & {
        last_edited?: number | null;
      }
    ): Promise<XanoAdminNote> {
      const res = await fetch(`${getBaseUrl()}/registration_admin_notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_edited: null, ...data }),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<Omit<XanoAdminNote, "id" | "created_at">>
    ): Promise<XanoAdminNote> {
      const res = await fetch(`${getBaseUrl()}/registration_admin_notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_admin_notes/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  registrationTypes: {
    async getAll(): Promise<XanoRegistrationType[]> {
      const res = await fetch(`${getBaseUrl()}/registration_type`, { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },

    async findByName(name: string): Promise<XanoRegistrationType | null> {
      const all = await this.getAll();
      return all.find((t) => t.type.toLowerCase() === name.toLowerCase()) ?? null;
    },
  },

  familyApplicationProgress: {
    /**
     * Fetch-or-create the row for this family + year, race-safe
     * against concurrent first-time creates.
     *
     * See the matching note on `studentRegistrationProgress.resolve`
     * for the full story — same race condition, same two-layer
     * defense (in-process mutex + post-create dedupe with
     * field-merging into the keeper). Underlying Xano table has no
     * unique index either, so without this guard concurrent callers
     * (parent /apply load + admin /admin/applications load + a
     * webhook firing) all race past the "exists?" check and each
     * create their own row.
     */
    async resolve(
      familyId: number,
      yearId: number,
      registration_type_id: number = 1
    ): Promise<XanoFamilyApplicationProgress> {
      const lockKey = `familyApplicationProgress:${familyId}:${yearId}`;
      const inflight = pendingProgressResolve.get(lockKey);
      if (inflight) return inflight as Promise<XanoFamilyApplicationProgress>;
      const promise = this._doResolve(
        familyId,
        yearId,
        registration_type_id
      ).finally(() => {
        pendingProgressResolve.delete(lockKey);
      });
      pendingProgressResolve.set(lockKey, promise);
      return promise;
    },

    async _doResolve(
      familyId: number,
      yearId: number,
      registration_type_id: number
    ): Promise<XanoFamilyApplicationProgress> {
      const all = await this._getAllMatches(familyId, yearId);
      if (all.length === 1) return all[0];
      if (all.length > 1) {
        return dedupeProgressRows(
          all,
          "xano.familyApplicationProgress",
          (id) => this.delete(id),
          (id, patch) => this.update(id, patch)
        );
      }

      const created = await this.create({
        registration_families_id: familyId,
        registration_school_years_id: yearId,
        family_completed: false,
        students_completed: false,
        financial_aid_completed: false,
        testing_completed: false,
        last_edited: Date.now(),
        submitted_at: null,
        isSubmitted: false,
        isAccepted: false,
        registration_type_id,
        registration_application_id: [],
      });

      const after = await this._getAllMatches(familyId, yearId);
      if (after.length <= 1) return after[0] ?? created;
      return dedupeProgressRows(
        after,
        "xano.familyApplicationProgress",
        (id) => this.delete(id),
        (id, patch) => this.update(id, patch)
      );
    },

    /**
     * Read every row matching `(familyId, yearId)`. Used by
     * `_doResolve`'s pre- and post-create checks; the dedupe helper
     * sorts + merges + cleans up.
     */
    async _getAllMatches(
      familyId: number,
      yearId: number
    ): Promise<XanoFamilyApplicationProgress[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_family_application_progress?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter(
          (r: XanoFamilyApplicationProgress) =>
            r.registration_families_id === familyId &&
            r.registration_school_years_id === yearId
        );
      } catch {
        return [];
      }
    },

    /** All progress rows for a school year — backs the admin Applications
     *  list. Calls the dedicated Xano query
     *  `registration_family_application_progress_by_year` with
     *  `registration_school_years_id` as input. Errors are logged with
     *  the response body (when available) so server logs reveal whether
     *  the issue is a 4xx from input-shape mismatch, a 5xx from Xano
     *  itself, or a transport error — silently returning [] used to
     *  hide all of those.  */
    async getByYear(yearId: number): Promise<XanoFamilyApplicationProgress[]> {
      try {
        const url = new URL(
          `${getBaseUrl()}/registration_family_application_progress_by_year`
        );
        url.searchParams.set("registration_school_years_id", String(yearId));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[xano.familyApplicationProgress.getByYear] ${res.status} for yearId=${yearId}: ${body}`
          );
          return [];
        }
        const items = await res.json();
        return Array.isArray(items) ? items : [];
      } catch (err) {
        console.error(
          `[xano.familyApplicationProgress.getByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    /**
     * Fetch the single row for this family + year, or null.
     *
     * See the matching note on `studentRegistrationProgress.getByFamilyAndYear`
     * for the duplicate-row story — same race condition applies here
     * since neither table has a Xano-side unique index. We collapse
     * to the most-recently-edited row (id-asc tiebreaker) so every
     * caller converges deterministically, and log a warning when
     * dupes are detected for one-time cleanup.
     */
    async getByFamilyAndYear(
      familyId: number,
      yearId: number
    ): Promise<XanoFamilyApplicationProgress | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_family_application_progress?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        const matches = items.filter(
          (r: XanoFamilyApplicationProgress) =>
            r.registration_families_id === familyId &&
            r.registration_school_years_id === yearId
        );
        if (matches.length === 0) return null;
        if (matches.length > 1) {
          console.warn(
            `[xano.familyApplicationProgress.getByFamilyAndYear] ${matches.length} duplicate progress rows for family=${familyId} year=${yearId}: ids=${matches
              .map((m: XanoFamilyApplicationProgress) => m.id)
              .join(",")} — picking most-recently-edited`
          );
        }
        const sorted = matches.slice().sort(
          (
            a: XanoFamilyApplicationProgress,
            b: XanoFamilyApplicationProgress
          ) => {
            const aEdit = a.last_edited ?? a.created_at ?? 0;
            const bEdit = b.last_edited ?? b.created_at ?? 0;
            if (aEdit !== bEdit) return bEdit - aEdit;
            return a.id - b.id;
          }
        );
        return sorted[0];
      } catch {
        return null;
      }
    },

    async create(
      data: Omit<XanoFamilyApplicationProgress, "id" | "created_at">
    ): Promise<XanoFamilyApplicationProgress> {
      const res = await fetch(
        `${getBaseUrl()}/registration_family_application_progress`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<Omit<XanoFamilyApplicationProgress, "id" | "created_at">>
    ): Promise<XanoFamilyApplicationProgress> {
      const res = await fetch(
        `${getBaseUrl()}/registration_family_application_progress/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /**
     * Used by the post-create dedupe in `resolve()` to clean up rows
     * created by losing-race callers. Hard delete because Xano won't
     * enforce uniqueness on its own — the only way to converge to one
     * row per (family, year) is to remove the strays.
     */
    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_family_application_progress/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error(
          `Xano error ${res.status}: ${await res.text().catch(() => "")}`
        );
      }
    },
  },

  reapplyFamilyProgress: {
    /** All reapply progress rows for a school year — backs the admin
     *  Reapply list. Calls the dedicated Xano query
     *  `reapply_family_progress_by_year` which expands each row's
     *  family record inline (under `_registration_families`). Errors
     *  are logged so server logs reveal whether the issue is
     *  input-shape, Xano-side, or transport. */
    async getByYear(
      yearId: number
    ): Promise<ReapplyProgressRow[]> {
      try {
        const url = new URL(
          `${getBaseUrl()}/reapply_family_progress_by_year`
        );
        url.searchParams.set("registration_school_years_id", String(yearId));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[xano.reapplyFamilyProgress.getByYear] ${res.status} for yearId=${yearId}: ${body}`
          );
          return [];
        }
        const items = await res.json();
        return Array.isArray(items) ? items : [];
      } catch (err) {
        console.error(
          `[xano.reapplyFamilyProgress.getByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    /** Fetch-or-create the row for this family + year. Mirrors the same
     *  pattern as the other progress helpers so server-side callers can
     *  always PATCH against an existing row. */
    async resolve(
      familyId: number,
      yearId: number
    ): Promise<XanoReapplyFamilyProgress> {
      const existing = await this.getByFamilyAndYear(familyId, yearId);
      if (existing) return existing;
      return this.create({
        registration_families_id: familyId,
        registration_school_years_id: yearId,
        isFamilyDetails: false,
        isStudentDetails: false,
        isScholarship: false,
        isTransportation: false,
        isSubmitted: false,
        last_edited: Date.now(),
      });
    },

    async getByFamilyAndYear(
      familyId: number,
      yearId: number
    ): Promise<XanoReapplyFamilyProgress | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/reapply_family_progress?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        return (
          items.find(
            (r: XanoReapplyFamilyProgress) =>
              r.registration_families_id === familyId &&
              r.registration_school_years_id === yearId
          ) ?? null
        );
      } catch {
        return null;
      }
    },

    async create(
      data: Omit<XanoReapplyFamilyProgress, "id" | "created_at">
    ): Promise<XanoReapplyFamilyProgress> {
      const res = await fetch(`${getBaseUrl()}/reapply_family_progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<Omit<XanoReapplyFamilyProgress, "id" | "created_at">>
    ): Promise<XanoReapplyFamilyProgress> {
      const res = await fetch(
        `${getBaseUrl()}/reapply_family_progress/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  studentRegistrationProgress: {
    /**
     * Fetch-or-create the single row for this family + year, race-safe
     * against concurrent first-time creates.
     *
     * Used by every server-side caller (parent app-flow GET, PandaDoc
     * webhook handlers, admin GET/PATCH routes) so there's always a
     * row to PATCH against. The previous implementation was a simple
     * "GET → CREATE if missing" that left a wide race window: two
     * callers would both see "no row" and both create their own,
     * producing duplicates that admin couldn't reconcile.
     *
     * The fix has two layers:
     *   1. **In-process mutex** (`pendingProgressResolve`) coalesces
     *      concurrent calls within a single Node process to one
     *      create. Solves the parent-page-load + admin-page-load
     *      race that's the dominant source of dupes.
     *   2. **Post-create dedupe** re-queries after the create and
     *      collapses any duplicates (cross-process races, or
     *      pre-existing dupes from before this fix shipped) into
     *      a single keeper. Non-empty fields from loser rows are
     *      merged into the keeper before deletion so dedupe never
     *      loses data — see `mergeProgressFields` for the predicate.
     *
     * Real fix is a Xano-side unique index on
     * `(registration_families_id, registration_school_years_id)`;
     * this client-side defense is the next-best thing.
     */
    async resolve(
      familyId: number,
      yearId: number,
      registration_type_id: number = 1
    ): Promise<XanoStudentRegistrationProgress> {
      const lockKey = `studentRegistrationProgress:${familyId}:${yearId}`;
      const inflight = pendingProgressResolve.get(lockKey);
      if (inflight)
        return inflight as Promise<XanoStudentRegistrationProgress>;
      const promise = this._doResolve(
        familyId,
        yearId,
        registration_type_id
      ).finally(() => {
        pendingProgressResolve.delete(lockKey);
      });
      pendingProgressResolve.set(lockKey, promise);
      return promise;
    },

    async _doResolve(
      familyId: number,
      yearId: number,
      registration_type_id: number
    ): Promise<XanoStudentRegistrationProgress> {
      // First check — a row may already exist from a previous
      // session, which is the common case after the first time
      // this family + year hit the API.
      const all = await this._getAllMatches(familyId, yearId);
      if (all.length === 1) return all[0];
      if (all.length > 1) {
        // Pre-existing dupes from before this fix shipped — collapse
        // them now without creating yet another row.
        return dedupeProgressRows(
          all,
          "xano.studentRegistrationProgress",
          (id) => this.delete(id),
          (id, patch) => this.update(id, patch)
        );
      }

      // No row yet — create one.
      const created = await this.create({
        registration_families_id: familyId,
        registration_school_years_id: yearId,
        registration_type_id,
        isTuition: false,
        isEnrollment: false,
        isRegistration: false,
        isVolunteerHours: false,
        tuition_scholarship_signature: null,
        signature_data_volunteer: null,
        volunteer_signature_data: null,
        name_volunteer: "",
        monthly_tuition_payment: 0,
        monthly_transportation_payment: 0,
        enrollment_agreement_pandadoc_id: "",
        enrollment_agreement_status: "",
        enrollment_agreement_sent: null,
        enrollment_agreement_pdf_url: "",
        is_enrollment_agreement_signed: false,
        signature_data: null,
        name: "",
        last_edited: Date.now(),
        submitted_date: null,
        isSubmitted: false,
      });

      // Re-check — if a parallel process raced past us, we now
      // have multiple rows. Dedupe and return the keeper.
      const after = await this._getAllMatches(familyId, yearId);
      if (after.length <= 1) return after[0] ?? created;
      return dedupeProgressRows(
        after,
        "xano.studentRegistrationProgress",
        (id) => this.delete(id),
        (id, patch) => this.update(id, patch)
      );
    },

    /**
     * Read every row matching `(familyId, yearId)` without any
     * de-duping or sorting. Used by `_doResolve`'s pre- and post-
     * create checks — both need the raw set of duplicates so the
     * shared dedupe helper can sort + merge + clean up.
     */
    async _getAllMatches(
      familyId: number,
      yearId: number
    ): Promise<XanoStudentRegistrationProgress[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration_progress?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter(
          (r: XanoStudentRegistrationProgress) =>
            r.registration_families_id === familyId &&
            r.registration_school_years_id === yearId
        );
      } catch {
        return [];
      }
    },

    /** All registration-progress rows for a school year — backs the
     *  admin Registrations list. Calls the dedicated Xano query
     *  `registration_student_registration_progress_by_year` with
     *  `registration_school_years_id` as input. Errors are logged so
     *  server logs reveal whether the issue is input-shape, Xano-side,
     *  or transport. */
    async getByYear(yearId: number): Promise<XanoStudentRegistrationProgress[]> {
      try {
        const url = new URL(
          `${getBaseUrl()}/registration_student_registration_progress_by_year`
        );
        url.searchParams.set("registration_school_years_id", String(yearId));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[xano.studentRegistrationProgress.getByYear] ${res.status} for yearId=${yearId}: ${body}`
          );
          return [];
        }
        const items = await res.json();
        return Array.isArray(items) ? items : [];
      } catch (err) {
        console.error(
          `[xano.studentRegistrationProgress.getByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    /**
     * Fetch the single row for this family + year, or null.
     *
     * The underlying Xano table has no uniqueness constraint on
     * `(registration_families_id, registration_school_years_id)`, so
     * concurrent first-time `resolve()` calls (parent loads /apply
     * + admin opens the family at the same time, or two PandaDoc
     * webhook fires landing simultaneously) can race past the
     * "exists?" check and each create their own row. Once that's
     * happened, every downstream PATCH/read sees one of the
     * duplicates and the others get stranded.
     *
     * The defensive fix: when the upstream returns multiple matches,
     * collapse to a single row by picking the one most likely to be
     * the "live" copy — most-recently-edited wins, with the lowest
     * id breaking ties so we always converge on the same row from
     * any caller. Also logs a warning when dupes are detected so
     * server logs reveal the data inconsistency for one-time
     * cleanup. Real fix is a Xano-side unique index; this just
     * stops the bleed.
     */
    async getByFamilyAndYear(
      familyId: number,
      yearId: number
    ): Promise<XanoStudentRegistrationProgress | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration_progress?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        const matches = items.filter(
          (r: XanoStudentRegistrationProgress) =>
            r.registration_families_id === familyId &&
            r.registration_school_years_id === yearId
        );
        if (matches.length === 0) return null;
        if (matches.length > 1) {
          console.warn(
            `[xano.studentRegistrationProgress.getByFamilyAndYear] ${matches.length} duplicate progress rows for family=${familyId} year=${yearId}: ids=${matches
              .map((m: XanoStudentRegistrationProgress) => m.id)
              .join(",")} — picking most-recently-edited`
          );
        }
        // Sort: last_edited desc, then id asc (stable tie-break so
        // every caller picks the same row).
        const sorted = matches.slice().sort(
          (
            a: XanoStudentRegistrationProgress,
            b: XanoStudentRegistrationProgress
          ) => {
            const aEdit = a.last_edited ?? a.created_at ?? 0;
            const bEdit = b.last_edited ?? b.created_at ?? 0;
            if (aEdit !== bEdit) return bEdit - aEdit;
            return a.id - b.id;
          }
        );
        return sorted[0];
      } catch {
        return null;
      }
    },

    async create(
      data: Omit<XanoStudentRegistrationProgress, "id" | "created_at">
    ): Promise<XanoStudentRegistrationProgress> {
      const res = await fetch(
        `${getBaseUrl()}/registration_student_registration_progress`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      data: Partial<Omit<XanoStudentRegistrationProgress, "id" | "created_at">>
    ): Promise<XanoStudentRegistrationProgress> {
      const res = await fetch(
        `${getBaseUrl()}/registration_student_registration_progress/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /**
     * Used by the post-create dedupe in `resolve()` to clean up rows
     * created by losing-race callers. Hard delete because Xano won't
     * enforce uniqueness on its own — the only way to converge to one
     * row per (family, year) is to remove the strays.
     */
    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_student_registration_progress/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error(
          `Xano error ${res.status}: ${await res.text().catch(() => "")}`
        );
      }
    },
  },

  inquiries: {
    async getAll(): Promise<XanoInquiry[]> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry`, { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },

    async getById(id: number): Promise<XanoInquiry> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, patch: Partial<XanoInquiry>): Promise<XanoInquiry> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },
};
