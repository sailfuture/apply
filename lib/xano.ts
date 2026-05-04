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
  opportunity_scholarship_award_amount: number;
  // PandaDoc signing — waiver + enrollment agreement state.
  liability_waiver_pandadoc_id: string;
  liability_waiver_status: string;
  liability_waiver_sent_at: string | null;
  liability_waiver_pdf_url: string;
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
   *  year has this set. */
  registrationConfirmed: boolean;
}

const pendingEnsure = new Map<string, Promise<XanoParent>>();

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
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_students?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((s) => s.registration_families_id === familyId && !s.isArchived);
        }
        const results: XanoStudent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter((s) => s.registration_families_id === familyId && !s.isArchived);
      } catch {
        const all = await this.getAll();
        return all.filter((s) => s.registration_families_id === familyId && !s.isArchived);
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
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((a) => a.registration_families_id === familyId);
        }
        const results: XanoApplication[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((a) => a.registration_families_id === familyId);
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
      return res.json() as Promise<XanoScholarshipContributingMember>;
    },

    async getAll(): Promise<XanoScholarshipContributingMember[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipContributingMember, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipContributingMember>;
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
        const results: XanoScholarshipContributingMember[] = await res.json();
        // ALWAYS filter client-side — Xano's auto-generated GET on
        // a child table treats query params as auxiliary filters, not
        // as the listing predicate. When the param is something Xano
        // doesn't recognize as a built-in (e.g. just the FK column
        // name), the response is the FULL table — every contributing
        // member for every scholarship in the system. Without this
        // filter, the admin Financial Aid view would surface other
        // families' members.
        return Array.isArray(results)
          ? results.filter(
              (m) =>
                m.registration_opportunity_scholarship_id === scholarshipId
            )
          : [];
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

    async update(id: number, data: Partial<Omit<XanoStudentRegistration, "id" | "created_at">>): Promise<XanoStudentRegistration> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
    /** Fetch-or-create the row for this family + year. Mirrors the
     *  pattern used by `studentRegistrationProgress.resolve` and
     *  `reapplyFamilyProgress.resolve` so server-side callers can
     *  always PATCH against an existing row. */
    async resolve(
      familyId: number,
      yearId: number,
      registration_type_id: number = 1
    ): Promise<XanoFamilyApplicationProgress> {
      const existing = await this.getByFamilyAndYear(familyId, yearId);
      if (existing) return existing;
      return this.create({
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

    /** Fetch the single row for this family + year, or null. */
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
        return (
          items.find(
            (r: XanoFamilyApplicationProgress) =>
              r.registration_families_id === familyId &&
              r.registration_school_years_id === yearId
          ) ?? null
        );
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
    /** Fetch-or-create the single row for this family + year. Used by every
     *  server-side caller (app-flow GET route, PandaDoc webhook handlers,
     *  etc.) so there is always a row to PATCH against. */
    async resolve(
      familyId: number,
      yearId: number,
      registration_type_id: number = 1
    ): Promise<XanoStudentRegistrationProgress> {
      const existing = await this.getByFamilyAndYear(familyId, yearId);
      if (existing) return existing;
      return this.create({
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

    /** Fetch the single row for this family + year, or null. */
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
        return (
          items.find(
            (r: XanoStudentRegistrationProgress) =>
              r.registration_families_id === familyId &&
              r.registration_school_years_id === yearId
          ) ?? null
        );
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
