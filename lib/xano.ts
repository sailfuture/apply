const BASE_URL = process.env.XANO_API_BASE_URL;

function getBaseUrl() {
  if (!BASE_URL) throw new Error("XANO_API_BASE_URL is not configured");
  return BASE_URL;
}

/**
 * GET with two retries + short backoff for the hot LIST accessors.
 * Xano intermittently fails under the burst load our fan-out routes
 * generate (rate limiting / transient 5xx); a single failed scan used
 * to degrade whole responses (e.g. every inbox name falling back to
 * "Family #id" until the next poll). Retrying smooths the blips.
 * Only used for idempotent reads — never writes.
 */
async function fetchRetry(url: string): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return res;
      last = res;
      // 4xx other than 429 won't get better on retry.
      if (res.status < 500 && res.status !== 429) return res;
    } catch {
      // Network-level failure — retry.
    }
  }
  if (last) return last;
  // All attempts threw — surface one real error for the caller's
  // existing catch handling.
  return fetch(url, { cache: "no-store" });
}

/** Host root for Xano — strips the `/api:<group>` suffix from
 *  `XANO_API_BASE_URL`. Useful when a query lives on a different API
 *  group than the one the base is pointed at; the caller can append
 *  `/api:<other-group>/<endpoint>` themselves. Currently used to
 *  reach the `2GcBXyoA` group (which hosts
 *  `registration_application_by_family`) without introducing a
 *  second env var. */
function getXanoHost(): string {
  return getBaseUrl().replace(/\/api:[^/]+\/?$/, "");
}

/** The staff-side operations API group (laptop inventory +
 *  assignments). Same Xano instance as the main group, different
 *  API-group path. */
function getOpsBaseUrl(): string {
  return `${getXanoHost()}/api:jzQ2liPL`;
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
  /** Timestamp (unix ms) when this parent opted out of SMS — set when
   *  they text STOP (Twilio also filters at the carrier level) or when
   *  admin opts them out by hand. Null/absent = still reachable; every
   *  outbound send checks this first. */
  sms_opted_out_at?: number | null;
  /** Provenance of the SMS consent on file — e.g. "implied_active"
   *  (already-enrolled family, service messages) or
   *  "registration_checkbox" (explicit opt-in captured at
   *  registration). Informational; the opt-out timestamp is what
   *  actually gates sends. */
  sms_consent_source?: string | null;
}

export interface XanoFamily {
  id: number;
  created_at: number;
  family_name: string;
  bus_transportation: boolean;
  registration_students_id: (number | Record<string, unknown> | unknown[])[];
  registration_parents_id: (number | Record<string, unknown> | unknown[])[];
  registration_fee_waiver_id: number | null;
  /** Stripe Customer id (e.g. `cus_NeHy7gPCu53J9p`). Long-lived,
   *  shared across academic years — one Customer per family. Null
   *  until admin starts monthly billing for the family for the
   *  first time (cascade on Confirm Registration, or manual Start
   *  Billing button). Subscriptions for individual years carry
   *  their own `stripe_subscription_id` on
   *  `registration_families_payment`, but they all attach to this
   *  single Customer. Optional on the type because legacy rows
   *  pre-date the column. */
  stripe_customer_id?: string | null;
  /** Residential / foster-family flag. When true, the parent's
   *  enrolled dashboard surfaces a "Create New Registration"
   *  affordance so the family can add students mid-year — foster
   *  placements enroll and unenroll throughout the academic year.
   *  Admin sets this from the family detail page. Optional because
   *  legacy rows pre-date the column; treat missing as `false`. */
  is_residential?: boolean;
  /** Unix-ms watermark stamped when the family last opened their
   *  Notifications page — the parent-side unread badge counts
   *  entries newer than this. Optional: requires the column + the
   *  input on the families edit endpoint in Xano; the client falls
   *  back to a per-device localStorage watermark until then. */
  notifications_read_at?: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIds(items: any[]): number[] {
  return items
    .filter((item) => item != null && !(Array.isArray(item) && item.length === 0))
    .map((item) => (typeof item === "number" ? item : item?.id))
    .filter((id): id is number => typeof id === "number");
}

/**
 * Normalize a single FK field that Xano may return either as a raw
 * number or as an expanded `{ id: N, ... }` relation object. Used by
 * resolve-style lookups that need to filter by FK — strict-equality
 * against the raw column blows past expanded relations and leaks
 * "row exists but I can't see it → create another one" duplicates.
 * Returns null when the value can't be coerced (e.g. `null`, missing
 * object id field, string that doesn't parse).
 */
function toIdOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    if (typeof id === "number" && Number.isFinite(id)) return id;
    if (typeof id === "string") {
      const n = Number(id);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
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

/** Metadata Xano's `/upload/image` returns and an image column stores.
 *  All fields optional — Xano's exact payload varies by version and we
 *  only read a couple for display. */
export interface XanoImageMetadata {
  path?: string;
  url?: string;
  name?: string;
  type?: string;
  size?: number;
  mime?: string;
  meta?: { width?: number; height?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface XanoStudent {
  id: number;
  created_at: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  /** Student's own phone number, stored as canonical 10-digit US
   *  digits (e.g. "8135550123"). Captured on the registration packet
   *  via the shared `PhoneInput`. Optional contact field — empty
   *  string when unset, and legacy rows pre-date the column add. */
  student_phone?: string;
  photo: string | null;
  /** Student photo — an Xano *image* column populated via the admin
   *  Student Photo card (client-compressed JPEG, uploaded through
   *  `/upload/image`). Stores Xano's image metadata object (path / url
   *  / name / size / mime / meta.width / meta.height). Optional +
   *  nullable: legacy rows predate the column and it's empty until an
   *  admin uploads one. Distinct from the legacy string `photo` above. */
  student_photo?: XanoImageMetadata | null;
  registration_families_id: number;
  registration_school_years_id: number[];
  isArchived: boolean;
  isAccepted: boolean;
  /** "Officially enrolled" gate on the Enrolled Students list. The
   *  registration-progress PATCH route cascades this true onto every
   *  family student the moment admin clicks Confirm Family
   *  Registration (i.e. `isRegistrationConfirmed` flips true on the
   *  family's `registration_student_registration_progress` row).
   *  The Unenroll modal clears it back to false (paired with
   *  `isArchived=true` + reason/date/notes). Optional because
   *  legacy rows pre-date the column add. */
  isEnrolled?: boolean;
  /** IDs of every `registration_student_registration` (packet) row this
   *  student has. One per year — Xano side adds a new row on re-enrollment,
   *  so this list grows over multi-year enrollment. */
  registration_student_registration_id: number[];
  // --- Document arrays (evergreen, live on the student) --------------------
  // Parents can upload multiple files per category (e.g. two pages of a
  // passport, a stack of medical forms). Each entry is Xano's file metadata
  // shape — `{ path, url, mime, size, meta, ... }`.
  //
  // Four of the categories — birth certificate, school health form,
  // transcripts, immunization forms — carry an admin-confirm triplet
  // (bool + audit time + audit admin name) so the registration packet's
  // Documents-to-Review surface can record per-document verification.
  // The remaining categories (passport, state id, IEP, SSN card) are
  // either optional or don't need a per-doc admin verify; only the
  // four required documents have the triplet today. All optional so
  // legacy rows pre-dating the columns keep typing.
  birth_certificate: Record<string, unknown>[];
  birth_certificate_admin_confirm?: boolean;
  birth_certificate_admin_confirm_time?: number | null;
  birth_certificate_admin_confirm_admin?: string;
  school_health_form: Record<string, unknown>[];
  school_health_form_admin_confirm?: boolean;
  school_health_form_admin_confirm_time?: number | null;
  school_health_form_admin_confirm_admin?: string;
  transcripts: Record<string, unknown>[];
  transcripts_admin_confirm?: boolean;
  transcripts_admin_confirm_time?: number | null;
  transcripts_admin_confirm_admin?: string;
  immunization_forms: Record<string, unknown>[];
  immunization_admin_confirm?: boolean;
  immunization_admin_confirm_time?: number | null;
  immunization_admin_confirm_admin?: string;
  passport: Record<string, unknown>[];
  student_state_id: Record<string, unknown>[];
  iep: Record<string, unknown>[];
  ssn_card: Record<string, unknown>[];
  /** Discipline records — evergreen multi-file upload (JSON list of
   *  Xano file metadata), gathered in the registration packet's
   *  Optional Documents section. Optional like the other non-required
   *  document categories; empty until a parent uploads, and legacy
   *  rows pre-date the column add. */
  discipline?: Record<string, unknown>[];

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

  /** Free-text reason captured when admin officially unenrolls a
   *  student via the Unenroll affordance on the enrolled detail
   *  page. Pairs with `unenrollment_date`, `unenrollment_notes`,
   *  and `isArchived=true`. Lives on the student row (not the
   *  per-year packet) so the audit follows the student across
   *  any re-enrollment attempts in future years. All optional
   *  because legacy rows pre-date the column add. */
  unenrollment_reason?: string;
  /** Effective date the unenrollment takes effect, in
   *  `YYYY-MM-DD` form (Xano `date` column). Admin picks this
   *  from a date input — defaults to today but can be
   *  back- or forward-dated. */
  unenrollment_date?: string | null;
  /** Long-form notes captured alongside the short reason —
   *  context the front-line admin needs to record but doesn't
   *  belong in the headline reason string. Optional; saved
   *  empty-string when admin leaves it blank. */
  unenrollment_notes?: string;
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
  /** Audit pair for `confirmed_scholarship`. Stamped by the admin
   *  applications PATCH route whenever `confirmed_scholarship`
   *  flips: confirming → time = now, admin = display name;
   *  un-confirming → time = null, admin = "". Clients shouldn't
   *  (and can't) hand-write these — the route owns them. Surfaced
   *  on the per-student row in the Scholarship Determination card
   *  so admin can see who confirmed each award and when. */
  confirmed_scholarship_time?: number | null;
  confirmed_scholarship_admin?: string;
  is_bus_transportation: boolean;
  bus_stop: string;
  /** Per-student transportation cost (decimal). Stored on the app
   *  row so admin can override the default per-student fee on a
   *  case-by-case basis without changing the school-year-level
   *  transport amount. Conventions:
   *   - `null` when `is_bus_transportation === false` (no transport
   *     elected — column accepts null so the receipt math distinguishes
   *     "no transport" from "transport at $0").
   *   - `number` when bus is elected. Defaults to the school year's
   *     `transportation_fees`, but admin can edit on the per-student
   *     Decision row.
   *  Optional on the type because legacy rows predate the column. */
  transportation_cost?: number | null;
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
  /** Marks an application created through the residential family's
   *  mid-year "Create New Registration" flow (foster placements added
   *  after the family is already enrolled). Kept out of the family-level
   *  "all students confirmed" enrolled rollups until this student is
   *  individually confirmed, so a fresh mid-year add never bounces the
   *  rest of the family out of their enrolled dashboard. Optional
   *  because legacy rows pre-date the column; treat missing as `false`. */
  is_residential_addition?: boolean;
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
  /** Per-student SUFS award amount captured at admin decision
   *  time. Mirrors the derived `sufsAmountFor(sufs_type, schoolYear)`
   *  computation but stored on the row directly so the audit
   *  snapshot survives future school-year tier-amount edits.
   *  Optional on the type because the column was added after
   *  launch; treat undefined / null / 0 as "no amount on file."
   *  When admin approves a family, the page sums these per-student
   *  values into `XanoFamilyPayment.sufs_total`. */
  sufs_award_amount?: number | null;
  /** Per-student billing columns mirroring the packet's billing
   *  columns. Admin edits land here pre-acceptance (when no packet
   *  exists yet); on acceptance these values get copied to the
   *  matching `registration_student_registration` row, which then
   *  becomes the source of truth post-acceptance. All nullable so
   *  rows can sit untouched. See `lib/per-student-billing.ts` for
   *  the derivation. */
  tuition_total?: number | null;
  opportunity_award_amount?: number | null;
  annual_fee?: number | null;
  sufs_amount?: number | null;
  tuition_sub_total?: number | null;
  monthly_amount?: number | null;
  /** Family-paid portion of tuition via the Opportunity Scholarship
   *  remainder — the "Remaining Amount Family Pays" admin enters on
   *  the Determination card. The Opportunity Scholarship covers the
   *  gap between this and tuition (after SUFS). Nullable so the
   *  default state distinguishes "untouched" from $0. */
  remaining_opportunity_amount?: number | null;
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

/**
 * Row shape returned by the Xano `registration_application_by_family`
 * query (api group `2GcBXyoA`). One row per active application for
 * the family + year, with the student, family, and school-year rows
 * already joined in via `_registration_*` addons. Used by the
 * acceptance-summary PDF so admin can render every label, name, and
 * school-year amount without a second round of fetches.
 *
 * `isActive=false` rows are filtered out by the Xano query itself;
 * the row type carries `isActive` for completeness in case a future
 * query revision exposes inactive rows again.
 */
export interface XanoApplicationByFamily extends XanoApplication {
  /** Embedded student row — the source the PDF reads for first +
   *  last name. Saves a separate students fetch + lookup map. */
  _registration_students_details?: XanoStudent | null;
  /** Embedded family row. Saves a separate families lookup for the
   *  `family_name` display string. */
  _registration_families?: Pick<XanoFamily, "id" | "family_name"> | null;
  /** Embedded school-year row. Tuition + annual fee + transportation
   *  fee live here; the per-SUFS-tier amounts (fes_eo_9, ftc_8, etc.)
   *  also ride along so the PDF can render the SUFS column without
   *  a side fetch. */
  _registration_school_years?: XanoSchoolYear | null;
  /** Embedded opportunity-scholarship row when one exists. `null`
   *  when the family is on a non-OS path (opted out, SNAP-only,
   *  etc.). The PDF still pulls the full scholarship payload from
   *  `/api/admin/scholarship-details` for contributing members /
   *  homes / vehicles — this is the lightweight reference. */
  _registration_opportunity_scholarship?: XanoScholarship | null;
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
  /** Epoch ms when admin "opened" re-applications for this year. Null
   *  while closed. Gates the re-application banner on the parent
   *  enrolled-family dashboard — returning families don't see a
   *  Re-apply card until admin flips this on from the year detail
   *  page, even if the year itself is already flagged `isNextYear`.
   *  Closing re-applications later (setting back to null) hides the
   *  banner for families who haven't started yet but leaves any
   *  in-flight progress rows alone — admin still sees them in the
   *  applications list. Optional on the type because legacy rows
   *  pre-date the column; treat missing as `null` / closed. */
  reapplications_opened_at?: number | null;
  /** Date the annual billing cycle starts (e.g. `"2025-08-01"`).
   *  Passed to Stripe as the Subscription's `trial_end` so the first
   *  charge defers until this date — families enrolling earlier in
   *  the year don't get billed upfront. Subscriptions created on or
   *  after this date charge immediately (no trial).
   *
   *  Format: ISO date string `YYYY-MM-DD`. Parsed as midnight UTC so
   *  the anchor is deterministic across the admin's local timezone
   *  and Stripe's server clock. Optional on the type because legacy
   *  rows pre-date the column; the Stripe Checkout flow refuses to
   *  start when this is null for a year with re-applications open. */
  billing_start_date?: string | null;
}

export interface XanoFamilyPayment {
  /** Internal id. Xano now exposes the table PK under
   *  `registration_families_payment_id` (the table-prefixed naming
   *  convention some other tables also use), but `lib/xano.ts` reads
   *  always normalize the response shape so callers can keep using
   *  `id`. Don't write to `id` — Xano manages it. */
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  isFamilyAccepted: boolean;
  signature: Record<string, unknown>;
  name: string;
  signature_data: Record<string, unknown> | null;
  /** Total annual transportation the family owes for the year. Sum of
   *  per-student transport fees for students whose
   *  `is_bus_transportation=true`. Set to `null` for SNAP families
   *  (transportation is waived for them) so downstream consumers can
   *  render N/A rather than `$0` and avoid charging in error.
   *  Optional on the type because legacy rows pre-date the column.
   *
   *  Stays on the family-payment row (vs. moving per-student) because
   *  the per-student transport columns haven't been added yet. When
   *  they are, this rolls up to a derived `Σ packet.transport_amount`. */
  transportation_total?: number | null;
  enrollment_agreement_pandadoc_id: string;
  enrollment_agreement_status: string;
  enrollment_agreement_sent_at: string | null;
  enrollment_agreement_pdf_url: string;
  is_enrollment_agreement_signed: boolean;
  /** Stripe Subscription id (`sub_...`). One per family per year —
   *  this row is per-(family, year), so the id is naturally scoped.
   *  Family-level parent record; per-student SubscriptionItem ids
   *  live on each `registration_student_registration` packet
   *  (`stripe_subscription_item_id`). Webhook handler stamps this
   *  on subscription.created; the per-student item ids are
   *  persisted by `lib/billing.ts` after `createSubscriptionWithStudentItems`
   *  returns.
   *
   *  Optional on the type because legacy rows pre-date the column. */
  stripe_subscription_id?: string | null;
}

/**
 * One row per Stripe Invoice generated for the family's monthly
 * tuition subscription. Mirror of Stripe state — populated by the
 * webhook handler (invoice.finalized / .paid / .payment_failed /
 * .voided) and the admin backfill endpoint. Stripe is still the
 * source of truth; this table exists so the admin billing surfaces
 * can aggregate (total paid, outstanding) across many families
 * without N+1 Stripe calls per page load.
 *
 * One invoice per billing month per family per year, generated by
 * Stripe at the cycle boundary — so a year's worth fills in slowly,
 * not all 12 at once.
 *
 * Uniqueness: enforce `stripe_invoice_id` unique in Xano so the
 * webhook can re-deliver without creating duplicate rows.
 */
export interface XanoPaymentTransaction {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  /** Pointer to the per-year billing row this invoice belongs to.
   *  Denormalized so the per-family schedule view can join cheaply. */
  registration_families_payment_id: number;
  /** Stripe's invoice id (`in_...`) — natural key for upserts from
   *  the webhook handler. Unique constraint expected at the Xano
   *  layer so re-delivered events PATCH instead of duplicate-insert. */
  stripe_invoice_id: string;
  /** Denormalized from the subscription so we can filter by sub
   *  without an extra join. Matches the value on the parent
   *  `registration_families_payment.stripe_subscription_id`. */
  stripe_subscription_id: string;
  /** Billing period (Stripe's `invoice.period_start` / `period_end`)
   *  in unix ms. Used to slot each invoice into its calendar month
   *  on the 12-month schedule view. */
  period_start: number;
  period_end: number;
  amount_due_cents: number;
  amount_paid_cents: number;
  /** Stripe invoice status: `draft`, `open`, `paid`, `void`,
   *  `uncollectible`. UI maps these to the friendlier
   *  Complete/Pending/Failed labels. */
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  due_date: number | null;
  /** Set on `invoice.paid`. Null while still open. */
  paid_at: number | null;
  /** Set on `invoice.finalized`. */
  finalized_at: number | null;
  /** Last time the webhook (or backfill) wrote this row. Used by
   *  the backfill endpoint to detect drift / re-sync stale rows. */
  last_synced_at: number;
}

/** Audit row written by `lib/emails/send.ts` after every Resend API
 *  call. Backs the admin "Sent emails" log on the family registration
 *  detail page so admin can confirm which notifications a family has
 *  received (and which failed / dry-ran).
 *
 *  XANO SCHEMA NOTE: create a table `registration_email_notifications`
 *  with the columns below before deploying — without it the audit
 *  writes 404 and the log table is empty. Columns:
 *    - id (int, pk, auto)
 *    - created_at (timestamp, auto)
 *    - registration_families_id (int, FK → registration_families)
 *    - registration_school_years_id (int, nullable — null for sends
 *      that aren't year-scoped)
 *    - template (text — matches the `tag` field on send, e.g.
 *      "application-received", "accepted", "not-accepted")
 *    - subject (text)
 *    - recipient_emails (text — comma-separated list)
 *    - cc_emails (text — comma-separated list)
 *    - status (text — "sent" | "failed" | "dry_run")
 *    - resend_id (text, nullable — Resend's email id when ok)
 *    - error_message (text, nullable — populated on failed sends)
 */
export interface XanoEmailNotification {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number | null;
  template: string;
  subject: string;
  recipient_emails: string;
  cc_emails: string;
  status: "sent" | "failed" | "dry_run" | string;
  resend_id: string | null;
  error_message: string | null;
  /** Unix-ms of the FIRST `email.opened` event from Resend's open
   *  tracking (stamped by /api/webhooks/resend). Null/absent = no
   *  open recorded. Optional — legacy rows predate the column. */
  opened_at?: number | null;
  /** The rendered HTML body as sent. Stored so the parent email
   *  viewer keeps working after Resend's retention window drops the
   *  message from their API (the reason old emails 404'd). Optional:
   *  requires an `html` text column + the input on the Add Record
   *  endpoint; rows written before it exists simply fall back to the
   *  Resend lookup. */
  html?: string | null;
}

/** Single volunteer-hour entry for a family. Rows are created by admin
 *  on the staff side as families log time at Academy events; the parent
 *  dashboard reads them via `volunteer_hours_by_family` (admin group).
 *
 *  `is_approved` flips true once admin has reviewed + verified the entry;
 *  the dashboard counts only approved hours toward the per-year / per-term
 *  totals so pending entries don't inflate progress. */
export interface XanoVolunteerHours {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  /** ISO date string (YYYY-MM-DD) for the day the family volunteered. */
  entry_date: string;
  hours: number;
  is_approved: boolean;
  approved_time: number | null;
  /** Name of the admin who approved the entry (" " = cleared — Xano
   *  edits drop empty strings, so unapproving writes the sentinel). */
  is_approved_admin: string;
  edited_at: number | null;
  /** FK to `school_calendar_events` — 0 = manual entry not tied to a
   *  calendar event. */
  school_calendar_events_id: number;
  /** Legacy columns dropped from the table (2026-07) — optional so
   *  older readers keep compiling; new rows never carry them. */
  activity_description?: string;
  activity_category?: string;
}

/**
 * One school-store product (`registration_store_items`) —
 * admin-managed catalog of things parents can buy in the portal
 * (uniform shirts, sweatshirts, …). Each item wraps a Stripe Payment
 * Link created in the Stripe Dashboard; the portal appends family
 * attribution to the URL at click time. `price_cents` is display-only
 * — the Payment Link's Stripe price is what actually gets charged.
 */
export interface XanoStoreItem {
  id: number;
  created_at: number;
  name: string;
  description: string;
  price_cents: number;
  payment_link_url: string;
  /** Hidden from parents when false — soft delete / seasonal items. */
  is_active: boolean;
  /** Parent-facing sort — ascending, ties broken by id. */
  sort_order: number;
}

/**
 * One school-store purchase (`registration_store_orders`) — mirrored
 * from Stripe by the webhook when a `checkout.session.completed`
 * event arrives for a Payment Link checkout. The parent portal
 * appends `client_reference_id=family-<id>-year-<yid>` to the store
 * links so the webhook can attribute the purchase; rows with
 * `registration_families_id: 0` are unattributed (someone paid via a
 * bare link shared outside the portal).
 *
 * `distributed` is the staff hand-out latch: flipping it stamps
 * `distributed_at` / `distributed_by` (0 / " " sentinels on undo —
 * Xano edits drop null and empty-string inputs).
 */
export interface XanoStoreOrder {
  id: number;
  created_at: number;
  /** FK to `registration_families` — 0 = unattributed purchase. */
  registration_families_id: number;
  /** FK to `registration_school_years` — 0 = unknown. */
  registration_school_years_id: number;
  /** FK to `registration_store_items` — resolved by matching the
   *  session's Payment Link URL against the catalog. 0 = unresolved
   *  (multi-product link, or the item was deleted). Drives the
   *  per-product sold / awaiting-pickup rollups. */
  registration_store_items_id: number;
  /** Natural idempotency key — one row per Stripe Checkout Session. */
  stripe_checkout_session_id: string;
  stripe_payment_link_id: string;
  /** Human summary of the line items, e.g. "Uniform Shirt ×2". */
  item: string;
  quantity: number;
  total_amount_cents: number;
  purchaser_email: string;
  /** From the Payment Link's checkout custom fields (a "Size"
   *  dropdown / "Student name" text configured on the link in the
   *  Stripe Dashboard). "" when the link doesn't collect them.
   *  Optional: columns added after launch. */
  size?: string;
  student_name?: string;
  /** Unix ms. Typed loose because the Xano column may be text —
   *  normalize with `Number()` before comparing/formatting. */
  paid_at: number | string;
  distributed: boolean;
  distributed_at: number | null;
  distributed_by: string;
}

/**
 * One physical device in the school's laptop inventory (`laptops`
 * on the operations API group `jzQ2liPL` — a DIFFERENT Xano group
 * from this app's tables; the inventory + assignment flow lives in
 * the staff-side system, this app only reads it and stamps the
 * enrolled-student linkage).
 */
export interface XanoLaptop {
  id: number;
  created_at: number;
  asset_number: string;
  serial_number: string;
  device_management_url: string;
  model: string;
  year_purchase: string;
  isArchived: boolean;
  reason_for_archive: string;
}

/**
 * One assignment of a device to a student (`laptop_assignments`,
 * same operations group). `students_id` is the staff system's own
 * student UUID — meaningless to this app. `enrolled_students_id` /
 * `enrolled_families_id` are the bridge columns admin stamps from
 * the Store page (0 = not linked) so the parent portal can show the
 * family their devices. `assigned_date` / `returned_date` are unix
 * ms; `returned_date` null/0 = still checked out. Conditions are
 * letter grades ("A"…).
 */
export interface XanoLaptopAssignment {
  id: number;
  created_at: number;
  laptops_id: number;
  students_id: string | null;
  assigned_date: number | null;
  assigned_condition: string;
  returned_date: number | null;
  returned_condition: string;
  notes: string;
  /** FK → registration_students (this app). 0 = not linked. */
  enrolled_students_id: number;
  /** FK → registration_families (this app). 0 = not linked. */
  enrolled_families_id: number;
}

/**
 * One Google Calendar appointment mirrored for a family
 * (`google_appointments`). Written ONLY by the calendar-sync cron:
 * every few minutes it reads the admissions@ calendar (the
 * impersonated account all bookings land on), matches attendee
 * emails against the parent roster, and upserts matched events here
 * — which is what surfaces bookings on the parent Notifications log
 * and the admin activity feed. Tour events the app created itself
 * are skipped (they already flow through `registration_tours`).
 */
export interface XanoGoogleAppointment {
  id: number;
  created_at: number;
  /** Natural idempotency key — one row per Google event. */
  google_event_id: string;
  /** Enrolled-family match (parents/students). 0 = none. */
  registration_families_id: number;
  /** Pre-account lead match (inquiry email / inquiry student name) —
   *  used when the family nets miss, since families book tours
   *  before they have portal accounts. 0 = none. Inquiry-matched
   *  bookings also get a note written into the lead's comms log. */
  registration_inquiry_id: number;
  title: string;
  location: string;
  /** Unix ms. */
  start_at: number;
  end_at: number;
  /** "confirmed" | "cancelled" — mirrors the Google event status. */
  status: string;
  /** The matched parent email (which attendee made this theirs). */
  attendee_email: string;
  last_synced_at: number;
}

export interface XanoScholarship {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  household_adults: number;
  household_children: number;
  no_contributing_member: boolean;
  // Monetary scholarship inputs are nullable on Xano now — null
  // means "untouched" (placeholder shown on the apply form), 0
  // means "explicitly entered zero" (e.g. family confirmed no
  // income from this source). Downstream scholarship math coerces
  // null -> 0 at the call site so the matrix bracket calculations
  // still work; the distinction matters for admin "did the family
  // fill this in?" reads.
  business_income_monthly: number | null;
  capital_gains_monthly: number | null;
  child_support_monthly: number | null;
  alimony_monthly: number | null;
  trusts_monthly: number | null;
  other_income_monthly: number | null;
  describe_other_income: string;
  assets_checking: number | null;
  assets_savings: number | null;
  assets_retirement_savings: number | null;
  assets_stocks_bonds_securities: number | null;
  assets_trusts_inheritance: number | null;
  assets_business: number | null;
  debts_credit_cards: number | null;
  debts_student_loans: number | null;
  debts_personal_loans: number | null;
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
  family_contribution_per_month: number | null;
  scholarship_advocacy_letter: string;
  signature: Record<string, unknown> | null;
  /** Typed full-name signature captured alongside the drawn signature on
   *  the scholarship certification block. Acts as a secondary attestation
   *  — the parent types their full legal name to confirm the drawn
   *  signature. Nullable on legacy rows. */
  full_name_signature?: string | null;
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

  /** Prior-year federal tax return — required on the Opportunity
   *  Scholarship path. Multi-file array (1040 + supporting schedules
   *  can land on the same row). Admin can upload on behalf of the
   *  family from the Documents to Review block on the family detail
   *  page. Optional on the type because legacy rows pre-date the
   *  column; treat missing as `[]` / not uploaded. */
  tax_return?: Record<string, unknown>[];
  /** Admin verification trail for the tax return. Mirrors the SNAP /
   *  unemployment confirm triplet but uses the newer column naming
   *  convention — `*_admin` is text (admin display name) instead of
   *  int (teacher id), matching the contributing-members + benefits
   *  audit pattern. The scholarships PATCH route auto-stamps both
   *  audit columns when admin flips `tax_document_confirm`. */
  tax_document_confirm?: boolean;
  tax_document_confirm_time?: number | null;
  tax_document_confirm_admin?: string;

  last_edited: number | null;
  /** Display name of the admin who last edited the parent-entered
   *  financial data through the admin family-detail Scholarship card.
   *  Server-stamped (paired with `last_edited`) by the admin
   *  scholarships PATCH route whenever a data field is in the patch;
   *  the card renders "Last edited by {name}". Empty/null until an
   *  admin edits. */
  last_edited_admin?: string | null;

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
   *   - `paystub_N_confirm_time` / `w2_confirmation` — millis
   *     timestamp set the moment admin marked the slot confirmed.
   *     Cleared (set to null) on undo. Note the column-name
   *     inconsistency on W-2: the Xano schema named the W-2
   *     timestamp column `w2_confirmation` rather than the
   *     `w2_confirm_time` you'd expect from the paystub
   *     convention. Don't "fix" this client-side or the PATCH
   *     gets rejected on an unknown column.
   *   - `*_admin_confirm` — the confirming admin's display name
   *     (string). Empty string when unset. Columns were originally
   *     typed `int` for teacher id but switched to `text` on Xano so
   *     the UI can render "Confirmed by Hunter Thompson" directly
   *     without a separate teacher-id → name lookup. The admin
   *     documents-review surface never writes these directly; the
   *     contributing-members PATCH endpoint stamps them automatically
   *     when a `*_confirm` flag is being flipped, so the audit trail
   *     can't drift away from the boolean's actual state. */
  w2_confirmation?: number | null;
  paystub_1_confirm_time?: number | null;
  paystub_2_confirm_time?: number | null;
  paystub_3_confirm_time?: number | null;
  paystub_4_confirm_time?: number | null;
  w2_admin_confirm?: string;
  paystub_1_admin_confirm?: string;
  paystub_2_admin_confirm?: string;
  paystub_3_admin_confirm?: string;
  paystub_4_admin_confirm?: string;
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
 * Enriched family record — `XanoFamily` with the FK arrays already
 * expanded:
 *   - `registration_students_id` → array of full application rows
 *     (one row per student per academic year for that family)
 *   - `registration_parents_id` → array of full parent rows
 *
 * COMPOSED by `xano.families.getAllDetails()` from three plain table
 * reads (families + parents + applications). It used to come from a
 * dedicated `/registration_families_all_details` Xano query, but that
 * endpoint was removed from the workspace and every consumer broke —
 * the shape lives on, the custom query does not.
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
  /** Summer-camp lead this note belongs to. One of the four LEAD FKs
   *  (inquiry / camp / visit / TASCO) — mutually exclusive with each
   *  other and with the family + progress-row scopes. */
  registration_summer_camp_id?: number | null;
  /** Liability-waiver visit lead this note belongs to. */
  website_liability_waiver_id?: number | null;
  /** TASCO summer-visit lead this note belongs to. */
  tasco_summer_visit_id?: number | null;
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

/** The four recruitment lead sources that can own a note. Same
 *  vocabulary the All Leads page and the SMS contact model use. */
export type LeadNoteSource = "inquiry" | "camp" | "visit" | "tasco";

export const LEAD_NOTE_SOURCES: LeadNoteSource[] = [
  "inquiry",
  "camp",
  "visit",
  "tasco",
];

/** Which `registration_admin_notes` FK column scopes a note to each
 *  lead source. ONE map so every read/write path agrees. */
export const LEAD_NOTE_COLUMN: Record<
  LeadNoteSource,
  | "registration_inquiry_id"
  | "registration_summer_camp_id"
  | "website_liability_waiver_id"
  | "tasco_summer_visit_id"
> = {
  inquiry: "registration_inquiry_id",
  camp: "registration_summer_camp_id",
  visit: "website_liability_waiver_id",
  tasco: "tasco_summer_visit_id",
};

/**
 * One SMS in a family's text thread (`sms_messages`). Both outbound
 * (staff-typed, automated triggers, group blasts) and inbound (family
 * replies) live here, distinguished by `direction`. Mirrors the
 * shape/access pattern of `XanoAdminNote` but adds the Twilio delivery
 * fields (sid, status, error) so the thread can show real send state.
 */
export interface XanoSmsMessage {
  id: number;
  created_at: number;
  /** Family this text belongs to — null when the message is attributed
   *  to an inquiry or summer-camp contact instead. Exactly one of the
   *  three contact FKs is set per row (see
   *  `contactMessageKeys` in `lib/sms/contacts.ts`). */
  registration_families_id: number | null;
  /** Inquiry contact (`registration_inquiry`) this text belongs to.
   *  Requires the nullable `registration_inquiry_id` column on the
   *  Xano `sms_messages` table + the input on its Add Record endpoint. */
  registration_inquiry_id?: number | null;
  /** Summer-camp contact (`registration_summer_camp`) this text
   *  belongs to. Same Xano column/input requirement as above. */
  registration_summer_camp_id?: number | null;
  /** Campus-visit waiver contact (`website_liability_waiver`) this
   *  text belongs to. Same Xano column/input requirement as above
   *  (column added 2026-07-22). */
  website_liability_waiver_id?: number | null;
  /** TASCO summer-visit contact (`tasco_summer_visit`) this text
   *  belongs to. Same Xano column/input requirement as above. Note the
   *  target table lives on the `2GcBXyoA` API group but this FK column
   *  lives on `sms_messages` in the main group like its siblings.
   *  Rows sent to an AD-HOC number (staff typed a phone that matches
   *  no record) carry NO contact FK at all — they thread by phone. */
  tasco_summer_visit_id?: number | null;
  /** Optional student/year context — set when a trigger text is about
   *  a specific student or year; null for general/manual/group texts. */
  registration_students_id?: number | null;
  registration_school_years_id?: number | null;
  /** `"outbound"` (we sent it) | `"inbound"` (family replied). */
  direction: string;
  /** E.164 numbers. For outbound, `to_number` is the family; for
   *  inbound, `from_number` is the family and `to_number` is us. */
  to_number: string;
  from_number: string;
  body: string;
  /** Twilio delivery status. Outbound:
   *  queued|sent|delivered|undelivered|failed (updated by the status
   *  callback). Inbound: "received". */
  status: string;
  /** Twilio Message SID (`SMxx…`) — natural key the status-callback
   *  webhook matches on to update `status`. Null until Twilio accepts
   *  the send. */
  twilio_message_sid?: string | null;
  /** What produced this text: "manual" (staff-typed), a trigger key
   *  ("application_received", "accepted", …), or "group:<slug>". Null
   *  for inbound. */
  template?: string | null;
  /** Twilio error code when status is failed/undelivered. */
  error_code?: string | null;
  /** Staff member who sent a manual or group text (denormalized).
   *  Null for automated triggers and inbound. */
  author_email?: string | null;
  author_name?: string | null;
  /** Billed SMS segment count (160 GSM-7 chars each), from Twilio. */
  segments?: number | null;
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
  /** Lifecycle bucket for the inquiry. `""`/undefined/`"active"` =
   *  active pipeline. `"converted"` = family applied (the win bucket).
   *  `"not_interested"` = family declined; these rows are filtered off
   *  the default inquiries view into their own section. Restore writes
   *  `"active"` rather than clearing to `""` because the Xano edit
   *  endpoint's field mapping skips empty inputs. */
  status?: string | null;
  /** Why the family wasn't interested — set alongside
   *  `status = "not_interested"`. Not cleared on restore (Xano skips
   *  empty inputs); consumers must only read it when
   *  `status === "not_interested"`. */
  status_reason?: string | null;
  /** Admin's 1–5 gut-feel star rating of how interested the family
   *  seems. 0/undefined = not yet rated; clicking the current rating
   *  clears back to 0. Unlike empty strings/null, integer 0 IS
   *  applied by the Xano edit endpoint (verified live). */
  interest_level?: number | null;
  /** FK → `registration_families` once this lead is known to have
   *  converted into an applying family. 0/undefined = not linked
   *  (0 is the clear sentinel — Xano's edit endpoints skip empty
   *  inputs, so null can never be written back). Stamped by the
   *  auto-matcher on application submit, the admin re-match sweep,
   *  or a manual link in the triage sheet. Same pair exists on all
   *  four lead tables. */
  registration_families_id?: number | null;
  /** Epoch ms when the conversion link was stamped; 0/undefined =
   *  never linked. */
  converted_at?: number | null;
  /** Which academic year this family is interested in — an FK to
   *  `registration_school_years`, set BY HAND from the lead lists.
   *  0/undefined = unassigned (left blank rather than guessed from
   *  the submission date: a family inquiring today may well be asking
   *  about the year after next, and only a person knows which).
   *
   *  Distinct from the year on `registration_application`: this is
   *  pre-application INTENT, and the two can legitimately disagree
   *  once the family actually applies. The application's year is
   *  authoritative from that point on. Same column on all four lead
   *  tables. */
  registration_school_years_id?: number | null;
}

/** One summer-camp registration/inquiry row (`registration_summer_camp`).
 *  Separate program from the school-year pipeline — no links to
 *  families/students tables; parents fill a standalone public form.
 *  `isNotAttending` is the archive flag: true = family backed out /
 *  won't attend, and the admin list groups those rows separately. */
export interface XanoSummerCampInquiry {
  id: number;
  created_at: number;
  isNotAttending: boolean;
  /** Admin flag — student actually showed up to camp. Optional because
   *  legacy rows predate the column; undefined reads as `false`. */
  attended_camp?: boolean;
  /** Admin's 1–5 conversion-likelihood stars (All Leads page). Same
   *  semantics as `XanoInquiry.interest_level`: 0/undefined = unrated. */
  interest_level?: number | null;
  /** Admin "we've reached out" flag — same semantics as
   *  `XanoInquiry.isFollowedUp`; undefined reads as `false`. */
  isFollowedUp?: boolean;
  /** Server-managed timestamp of the most recent note on this lead.
   *  Bumped by the notes POST endpoint; never hand-edited (the admin
   *  PATCH allowlists exclude it). */
  last_reach_out?: number | null;
  /** Conversion link + stamp — see the matching pair on `XanoInquiry`. */
  registration_families_id?: number | null;
  converted_at?: number | null;
  /** Academic year this family is interested in (hand-assigned FK to
   *  `registration_school_years`; 0 = unassigned) — see `XanoInquiry`. */
  registration_school_years_id?: number | null;
  /** WHICH camp the student actually attended, as an FK to
   *  `registration_school_years` (0 = not recorded). Distinct from
   *  the column above: that one is the year the family is ASKING
   *  about, this one is a camp they've already been to. Camp runs in
   *  June/July, which falls inside the school year ending that
   *  summer — so a summer-2026 camp reads as "2025-2026".
   *
   *  Camp-table only; the other three lead sources have no camp. */
  summer_camp_year_attended?: number | null;
  /** Lifecycle bucket + decline reason — same semantics as
   *  `XanoInquiry.status`/`status_reason` (""/undefined/"active" =
   *  active pipeline, "not_interested" = family declined; restore
   *  writes "active" because Xano drops empty inputs). Columns must
   *  exist in Xano before writes land; the leads PATCH route
   *  echo-verifies and warns when they don't. */
  status?: string | null;
  status_reason?: string | null;
  student_first_name: string;
  student_last_name: string;
  gender: string;
  ethnicity: string;
  swim_level: string;
  transportation: string;
  bus_stop: string;
  current_school: string;
  last_grade_completed: string;
  describe_your_student_and_behavior: string;
  allergies: string;
  dietary_restrictions: string;
  health_conditions: string;
  hearing_or_visual_impairments: string;
  additional_health_information: string;
  carry_epi_pen: boolean;
  preferred_hospital: string;
  primary_parent_first_name: string;
  primary_parent_last_name: string;
  primary_parent_relationship: string;
  primary_phone: string;
  primary_email: string;
}

/** One campus-visit liability waiver signed on the marketing site
 *  (`website_liability_waiver`). Public form — visitors sign before a
 *  campus tour; no links to families/students. `signature_image` is
 *  Xano file metadata (path under /vault). The table has NO school-year
 *  column: the academic year is derived from the signing date by the
 *  campus-visits admin route. */
export interface XanoWebsiteLiabilityWaiver {
  id: number;
  created_at: number;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  student_name: string;
  student_grade: string;
  student_school: string;
  signature_image: { url?: string; path?: string } | null;
  /** ISO date (`YYYY-MM-DD`) the signer picked, when the form captured
   *  one. `signed_at` (epoch ms) is the authoritative timestamp. */
  signed_date: string | null;
  marketing_opt_in: boolean;
  signed_ip: string;
  user_agent: string;
  signed_at: number | null;
  /** Admin's 1–5 conversion-likelihood stars (All Leads page).
   *  0/undefined = unrated. */
  interest_level?: number | null;
  /** Admin "we've reached out" flag; undefined reads as `false`. */
  isFollowedUp?: boolean;
  /** Server-managed timestamp of the most recent note on this lead. */
  last_reach_out?: number | null;
  /** Conversion link + stamp — see the matching pair on `XanoInquiry`. */
  registration_families_id?: number | null;
  converted_at?: number | null;
  /** Academic year this family is interested in (hand-assigned FK to
   *  `registration_school_years`; 0 = unassigned) — see `XanoInquiry`. */
  registration_school_years_id?: number | null;
  /** Lifecycle bucket + decline reason — see `XanoInquiry`. */
  status?: string | null;
  status_reason?: string | null;
}

/** One TASCO summer-visit sign-up (`tasco_summer_visit`). Public form
 *  collected at St. Pete recreation centers over the summer — a
 *  recruitment lead list, with no link to families/students and no
 *  school-year column. `parent_email` is frequently blank (many were
 *  captured phone-only at the center). Lives on the `2GcBXyoA` API
 *  group. */
export interface XanoTascoSummerVisit {
  id: number;
  created_at: number;
  student_name: string;
  current_grade: string;
  current_school: string;
  /** Which rec center the student signed up at. Free text — the same
   *  center appears under several spellings ("J.W. Cate Recreation
   *  Center" / "jwcate recreation cenetre"), so the admin route
   *  normalizes it for grouping/filtering. */
  recreation_center: string;
  parent_phone: string;
  parent_email: string;
  marketing_opt_in: boolean;
  /** Admin's 1–5 conversion-likelihood stars (All Leads page).
   *  0/undefined = unrated. */
  interest_level?: number | null;
  /** Admin "we've reached out" flag; undefined reads as `false`. */
  isFollowedUp?: boolean;
  /** Server-managed timestamp of the most recent note on this lead. */
  last_reach_out?: number | null;
  /** Conversion link + stamp — see the matching pair on `XanoInquiry`. */
  registration_families_id?: number | null;
  converted_at?: number | null;
  /** Academic year this family is interested in (hand-assigned FK to
   *  `registration_school_years`; 0 = unassigned) — see `XanoInquiry`. */
  registration_school_years_id?: number | null;
  /** Lifecycle bucket + decline reason — see `XanoInquiry`. */
  status?: string | null;
  status_reason?: string | null;
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
  /** Application type discriminator. `"New Application"` for new
   *  applicants going through the apply flow for the first time;
   *  `"Re-Enrollment"` for returning families re-applying for a new
   *  year. Mirrors the same field on `registration_application` rows.
   *  Drives the Initial Testing (NWEA) gate: re-enrollers skip the
   *  testing step because they already have valid scores on prior
   *  apps, and the `useApplicationSteps` hook filters that step out
   *  of the side-nav + completion-count math for them.
   *  Optional on the type because legacy rows predate the column add;
   *  treat as `"New Application"` when absent. */
  type?: "New Application" | "Re-Enrollment" | string;
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
  // The Financial Aid section's verify triplet was added separately
  // from the apply-flow triplets above so the column names differ:
  // `*_admin_complete` instead of `*_admin_confirm`, and
  // `*_admin_time` instead of `*_admin_confirm_time`. The admin
  // family-progress route accepts the canonical
  // `financial_aid_admin_confirm` boolean as input and writes it to
  // `financial_aid_admin_complete` on Xano (along with the time +
  // admin name pair) so the rest of the codebase can keep the
  // confirm-suffix naming convention internally.
  family_admin_confirm?: boolean;
  family_admin_confirm_time?: number | null;
  family_admin_confirm_admin?: string;
  students_admin_confirm?: boolean;
  students_admin_confirm_time?: number | null;
  students_admin_confirm_admin?: string;
  testing_admin_confirm?: boolean;
  testing_admin_confirm_time?: number | null;
  /** Financial Aid section-verify triplet. Uses the same
   *  `*_admin_confirm` / `*_admin_confirm_time` /
   *  `*_admin_confirm_admin` column naming as Family / Students /
   *  Testing — the earlier `_admin_complete` / `_admin_time`
   *  naming we used briefly was wrong (those columns don't exist
   *  on Xano). The bool gates the Approve flow alongside the
   *  other section verifies. */
  financial_aid_admin_confirm?: boolean;
  financial_aid_admin_confirm_time?: number | null;
  financial_aid_admin_confirm_admin?: string;
  /** Scholarship Determination section-verify triplet. Note the
   *  timestamp column is `scholarship_complete_admin_time` (NOT
   *  `scholarship_admin_complete_time`) — the Xano column name
   *  has the words in that specific order, diverging from the
   *  bool's `scholarship_admin_complete` order. Like the W-2
   *  audit column above, don't "normalize" the divergence away
   *  client-side or the PATCH gets rejected on an unknown
   *  column. */
  scholarship_admin_complete?: boolean;
  scholarship_complete_admin_time?: number | null;
  scholarship_admin_complete_admin?: string;

  // ── Email-notification tracking ────────────────────────────────
  // These columns gate the cron-driven reminder emails (Email 5
  // draft reminder, Email 6 enrollment-agreement reminder, Email 11
  // back-to-school). All four are optional on the type because the
  // columns were added after launch — undefined and null both mean
  // "not stamped." Stamp values are unix-ms `Date.now()` timestamps.
  //
  // XANO SCHEMA NOTE: add these four columns to
  // `registration_family_application_progress` as nullable int
  // (timestamp) types before deploying the cron — otherwise the
  // reminder dedupe writes will silently fail on the Xano side
  // and the cron will spam the same email every tick.

  /** Stamped by `/api/admin/family-progress` on the first
   *  `isAccepted` false → true transition. Cleared back to null
   *  when admin revokes acceptance so a fresh accept restarts the
   *  reminder window. Anchors Email 6's "5 days since acceptance"
   *  computation in the cron. */
  accepted_at?: number | null;
  /** Stamped by the cron once Email 5 (draft reminder) has been
   *  sent for this family + year. One-way latch — never cleared,
   *  so families that drift in and out of the 3-5 day window only
   *  receive the nudge once. */
  draft_reminder_sent_at?: number | null;
  /** Stamped by the cron once Email 6 (enrollment-agreement
   *  reminder) has been sent for this family + year. Cleared
   *  alongside `accepted_at` when admin revokes acceptance so a
   *  re-accept can re-send. */
  acceptance_reminder_sent_at?: number | null;
  /** Stamped by the cron once Email 11 (back-to-school) has been
   *  sent for this family + year. One-way latch — even if a parent
   *  un-enrolls and re-enrolls before August, we only welcome them
   *  back-to-school once per year. */
  back_to_school_sent_at?: number | null;
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

  // --- Family enrollment-agreement fields ---------------------------------
  // Family-level (one per family per year). The PandaDoc envelope +
  // signature live here; per-student tuition amounts moved to
  // `registration_student_registration` (one row per student) so this
  // row no longer carries `monthly_tuition_payment` /
  // `monthly_transportation_payment` rollups — those are derived from
  // packet sums via `sumFamilyBillingTotals`.
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
  // section confirms.
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
  /** Registration Packet section family-level verify triplet. The
   *  section's per-student data still lives on each
   *  `registration_student_registration.registrationConfirmed` row,
   *  but admin also wants a single family-level "I've reviewed the
   *  whole packet section" pin — same pattern as Tuition/Enrollment/
   *  Volunteer. Note the column name uses `is_registration_*` rather
   *  than `registration_*` to keep it distinguishable from the
   *  `registration_confirmed_*` family-level rollup latch (different
   *  semantic: this one is the per-section verify, that one is the
   *  whole-family final confirmation). */
  is_registration_admin_confirm?: boolean;
  is_registration_admin_confirm_time?: number | null;
  registration_admin_confirmed_admin?: string;

  /** Family-level "registration confirmed" latch — the rollup admin
   *  flips after every per-section verify (tuition, enrollment,
   *  volunteer, emergency contacts) AND every per-student
   *  `registrationConfirmed` packet is set. Mirrors the apply-flow
   *  `isAccepted` latch on `registration_family_application_progress`
   *  in spirit: it's the final "this family is fully registered"
   *  signal, distinct from the parent-side `isSubmitted` flag (which
   *  marks "the parent has hit Submit"). The audit pair stamps who
   *  flipped it and when. All three optional because legacy rows
   *  predate the column add. */
  isRegistrationConfirmed?: boolean;
  registration_confirmed_time?: number | null;
  registration_confirmed_admin?: string;
  /** Family-level archive flag. Mirrors `is_archived` on the apply-
   *  flow `family_application_progress` row — admin uses this to set
   *  a family's registration aside (post-acceptance withdrawals,
   *  duplicate rows, etc.) without destroying any uploaded packet
   *  data. The archived row drops out of the active Registrations
   *  queues but stays reachable for un-archive. Optional because
   *  legacy rows predate the column add. */
  isArchived?: boolean;
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
  /** Stripe SubscriptionItem id for this student's recurring tuition
   *  line on the family's per-year subscription. Lives on the per-year
   *  packet (not the evergreen student row) because each enrollment
   *  year is its own subscription with its own item — re-enrolling
   *  the same student next year creates a brand new packet row + new
   *  Stripe item, independent of last year's id.
   *
   *  Non-null when the student is currently being billed (one item
   *  per student, all rolled into one family invoice). Cleared when
   *  the student is archived/unenrolled — the cascade removes the
   *  item from Stripe AND nulls this column so the two sources
   *  can't drift.
   *
   *  Orthogonal to the student's `isArchived` flag (which lives on
   *  `registration_students` and means "evergreen-not-in-program").
   *  Valid combinations:
   *    - student.isArchived=false, this id=non-null → enrolled, billing
   *    - student.isArchived=false, this id=null     → enrolled, billing not yet started
   *    - student.isArchived=true,  this id=null     → unenrolled
   *  The id-non-null + student.isArchived=true combo would be a bug
   *  (cascade half-failed); audit logs flag it.
   *
   *  XANO SCHEMA NOTE: nullable `text` column named
   *  `stripe_subscription_item_id` on
   *  `registration_student_registration`. */
  stripe_subscription_item_id?: string | null;

  // Per-student billing math (tuition_total, sufs_amount,
  // opportunity_award_amount, annual_fee, tuition_sub_total,
  // monthly_amount, remaining_opportunity_amount) and the SUFS
  // audit snapshot (sufs_type, sufs_status, sufs_award_id) now live
  // exclusively on `registration_application`. Single source of
  // truth — admin enters values on the Determination card and they
  // persist on the application row. `stripe_subscription_item_id`
  // above is the only billing column that remains on the packet
  // because it's billing infrastructure (the Stripe-side link),
  // not billing math.

  // ── Step Up For Students reconciliation (admin-only, the
  //    /admin/sufs page). Three-stage pipeline per student:
  //      1. `sufs_enrollment_request_sent`      — admin sent the
  //         enrollment request on the Step Up portal.
  //      2. `sufs_parent_enrollment_confirmation` — parent completed
  //         their side of the enrollment (admin-verified).
  //      3. `sufs_q1..q4_payment`               — quarterly Step Up
  //         payment confirmations.
  //    None of these feed billing math (that reads `sufs_amount` on
  //    the application row). Every audit pair (`*_time` / `*_by`,
  //    `*_confirmed` / `*_confirmed_by`) is stamped server-side by
  //    `/api/admin/student-registration/[id]` — never client-
  //    writable. All optional because rows predate the columns;
  //    treat `undefined` as false/empty. Notes are cleared via a
  //    single-space sentinel because Xano's edit endpoint drops
  //    empty-string inputs.
  sufs_enrollment_request_sent?: boolean;
  sufs_enrollment_request_notes?: string;
  sufs_enrollment_request_time?: number | null;
  sufs_enrollment_request_by?: string;
  sufs_parent_enrollment_confirmation?: boolean;
  /** Audit pair for `sufs_parent_enrollment_confirmation` — the Xano
   *  column names say "request" but they stamp the CONFIRMATION
   *  flip (who marked it, when). */
  sufs_parent_enrollment_request_time?: number | null;
  sufs_parent_enrollment_request_by?: string;
  sufs_q1_payment?: boolean;
  /** `sufs_qN_payment_confirmed` is the ms TIMESTAMP of the payment
   *  confirmation (null when unpaid); `_confirmed_by` is the admin
   *  display name. */
  sufs_q1_payment_confirmed?: number | null;
  sufs_q1_payment_confirmed_by?: string;
  sufs_q2_payment?: boolean;
  sufs_q2_payment_confirmed?: number | null;
  sufs_q2_payment_confirmed_by?: string;
  sufs_q3_payment?: boolean;
  sufs_q3_payment_confirmed?: number | null;
  sufs_q3_payment_confirmed_by?: string;
  sufs_q4_payment?: boolean;
  sufs_q4_payment_confirmed?: number | null;
  sufs_q4_payment_confirmed_by?: string;

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
   *  Optional because the columns were added after launch. The
   *  admin name column previously carried a `regisration_*` typo
   *  on the Xano side; it's been corrected to
   *  `is_registration_admin_confirm_admin`. */
  registration_confirmed_admin_time?: number | null;
  is_registration_admin_confirm_admin?: string;
  /** Admin-only placement fields — set from the enrolled-student
   *  detail page's Placement card, NOT part of the parent flow.
   *  Optional because they were added after launch (existing rows
   *  predate them) and aren't part of the packet `create` defaults.
   *
   *  `grade_level` — the student's grade for this year ("8th"–"12th").
   *  `crew_assignment` — the student's crew ("Crew A"–"Crew E").
   *  `previous_crew_assignment` + `crew_assignment_change` — audit
   *  pair stamped server-side by `/api/admin/student-registration/[id]`
   *  whenever `crew_assignment` changes, so admin can see what the
   *  prior crew was and when the move happened. */
  grade_level?: string;
  crew_assignment?: string;
  previous_crew_assignment?: string;
  crew_assignment_change?: number | null;
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
  Promise<
    | XanoStudentRegistrationProgress
    | XanoFamilyApplicationProgress
    | XanoStudentRegistration
  >
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
 * Dedupe duplicate packets in `registration_student_registration`
 * down to a single keeper. Sorts by `last_edited_time` desc, falling
 * back to `created_at` desc and then id asc so every caller
 * converges on the same keeper. Loser rows are hard-deleted; failure
 * to delete is logged but doesn't block the resolve (the next call
 * retries the cleanup). Packets carry far more state than the
 * progress-row dedupe handles, so this helper deliberately doesn't
 * merge fields — the keeper survives intact and we drop the losers.
 * Callers should ensure the keeper has the up-to-date columns.
 */
async function dedupeStudentRegistrationRows(
  matches: XanoStudentRegistration[],
  deleteFn: (id: number) => Promise<void>
): Promise<XanoStudentRegistration> {
  if (matches.length === 1) return matches[0];
  const sorted = matches.slice().sort((a, b) => {
    const aT = a.last_edited_time ?? a.created_at ?? 0;
    const bT = b.last_edited_time ?? b.created_at ?? 0;
    if (aT !== bT) return bT - aT;
    return a.id - b.id;
  });
  const keeper = sorted[0];
  const losers = sorted.slice(1);
  console.warn(
    `[xano.studentRegistration.resolve] ${matches.length} duplicate packets detected; keeping id=${keeper.id} and deleting ${losers
      .map((l) => l.id)
      .join(",")}`
  );
  await Promise.allSettled(
    losers.map((l) =>
      deleteFn(l.id).catch((err) => {
        console.warn(
          `[xano.studentRegistration.resolve] delete of loser id=${l.id} failed:`,
          err
        );
      })
    )
  );
  return keeper;
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

  const created = await xano.parents.create({
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

  // Post-create duplicate check. The pre-create `findByClerkId` above
  // can't stop a cross-instance race (two serverless invocations both
  // see "no row" and both insert — the in-memory `pendingEnsure` mutex
  // only covers one instance, and Xano has no unique constraint to
  // reject the second insert). Re-resolve after inserting:
  // `findByClerkId` deterministically returns the OLDEST match, so if
  // it comes back with a row older than ours, a concurrent creator won
  // — delete our duplicate and adopt theirs. The oldest row never
  // deletes itself, so concurrent losers converge on one survivor.
  try {
    const canonical = await xano.parents.findByClerkId(clerkUserId);
    if (canonical && canonical.id < created.id) {
      await xano.parents.delete(created.id);
      return canonical;
    }
  } catch {
    // Best-effort — a failed dedupe leaves an extra row, which readers
    // already tolerate via the oldest-row pick in `findByClerkId`.
  }
  return created;
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

/**
 * Same PK-promotion trick as `normalizeContributingMemberPK` above
 * but for `registration_families_payment`. Xano exposes the PK
 * under `registration_families_payment_id` rather than the plain
 * `id` the rest of our code reads — left unfixed, every read path
 * sees `id: undefined`, the upsert in
 * `/api/admin/family-payment` calls `update(undefined, ...)` (404
 * or worse), and accepting a family appears to silently no-op.
 * This shim keeps callers on the `id` contract while tolerating
 * either column name on the wire.
 */
function normalizeFamilyPaymentPK(
  raw: Record<string, unknown>
): XanoFamilyPayment {
  const out = { ...raw };
  if (
    (out.id === undefined || out.id === null) &&
    typeof out.registration_families_payment_id === "number"
  ) {
    out.id = out.registration_families_payment_id;
  }
  return out as unknown as XanoFamilyPayment;
}

/**
 * One day of the school calendar (`school_calendar`) — one row per
 * calendar day per school year, seeded when the year's calendar is
 * generated. `schoolyears_id` matches the registration year ids the
 * top-bar year picker uses. `terms_id` groups days into terms (no
 * terms endpoint exists — consumers label them ordinally). The six
 * boundary flags mark term / externship-rotation / internship-rotation
 * start and end days.
 */
export interface XanoSchoolCalendarDay {
  id: number;
  created_at: number;
  schoolyears_id: number;
  /** YYYY-MM-DD. */
  date: string;
  terms_id: number;
  seasons_id: number;
  /** "School" | "Weekend" | "Break". */
  type: string;
  day_of_week: string;
  holiday: boolean;
  break: boolean;
  /** "Externship" | "Internship" | "" (non-work days). */
  work_type: string;
  last_day_term: boolean;
  first_day_term: boolean;
  last_day_extern_term: boolean;
  first_day_extern_term: boolean;
  last_day_intern_term: boolean;
  first_day_intern_term: boolean;
}

/**
 * An event pinned to one school-calendar day (`school_calendar_events`).
 * `start_time` / `end_time` are unix-ms timestamps (0/null = not set —
 * an all-day event). `parent_volunteer_hours` marks events parents can
 * attend for volunteer-hour credit, worth `volunteer_hour_total` hours.
 */
export interface XanoSchoolCalendarEvent {
  id: number;
  created_at: number;
  school_calendar_id: number;
  start_time: number | null;
  end_time: number | null;
  title: string;
  description: string;
  location: string;
  mandatory: boolean;
  parent_volunteer_hours: boolean;
  volunteer_hour_total: number;
  /** Parent sign-up capacity for the RSVP flow — how many parent
   *  spots families can reserve. 0 = sign-ups not offered (the event
   *  doesn't appear on the parent volunteer page's Upcoming list).
   *  Optional because legacy rows predate the column. */
  parent_spots?: number;
  /** What the event needs from families — one need per line
   *  ("4 chaperones", "Water jugs", …). Rendered as a bulleted list
   *  on the parent calendar + volunteer surfaces. " " = cleared
   *  (Xano edits drop empty strings). Optional: legacy rows predate
   *  the column. */
  needs?: string;
  /** Event-category color slug ("sky" | "emerald" | "violet" |
   *  "amber" | …) — "" / " " = uncategorized. The single-space form
   *  exists because Xano's edit endpoints drop empty-string inputs,
   *  so clearing a color PATCHes " " (trim before comparing). */
  color: string;
}

/**
 * One family's RSVP to a calendar event (`school_event_rsvps`).
 * One row per (event, family) — the parent RSVP endpoint upserts, so
 * re-submitting edits the existing reservation. `spots` is how many
 * parent seats the family reserved; the endpoint enforces the event's
 * `parent_spots` capacity across all families at write time.
 * `comment` is free text from the parent ("Maria + grandma Ana").
 */
export interface XanoEventRsvp {
  id: number;
  created_at: number;
  school_calendar_events_id: number;
  registration_families_id: number;
  spots: number;
  comment: string;
}

/**
 * An academic term (`registration_academic_terms`) — a named date
 * range within a school year ("Term 1"…). `school_calendar.terms_id`
 * points at these ids. Dates are "YYYY-MM-DD" or null on legacy rows
 * that predate the date columns.
 */
export interface XanoAcademicTerm {
  id: number;
  created_at: number;
  term_name: string;
  start_date: string | null;
  end_date: string | null;
  registration_school_years_id: number;
  isActive: boolean;
}

/**
 * An academic season (`registration_academic_seasons`) — a named
 * stretch tied to a school year and optionally one term
 * (`registration_academic_terms_id` 0 = not linked). Seasons carry no
 * dates of their own; their range comes from the linked term.
 */
export interface XanoAcademicSeason {
  id: number;
  created_at: number;
  name: string;
  registration_school_years_id: number;
  registration_academic_terms_id: number;
}

/**
 * A scheduled campus tour (`registration_tours`) for a recruitment
 * lead. Deliberately NOT a `school_calendar_events` row — those are
 * school-wide and pinned to seeded day rows; a tour belongs to one
 * lead and syncs to Google Calendar instead.
 *
 * Lead linkage uses the SAME four nullable table-reference columns as
 * `registration_admin_notes` (one per source, at most one set — see
 * `LEAD_NOTE_COLUMN`), so a tour is a real linked record in the Xano
 * data browser: admin can inspect — or hand-link an imported website
 * booking the email matcher couldn't place — right in Xano, and the
 * app reads whatever the columns say via `tourLeadScope`. A tour with
 * all four null is "unlinked" (website booking with no matching
 * lead). The snapshot columns below keep rows self-describing even if
 * the lead is later edited or deleted.
 *
 * Xano quirks this table lives with: edit endpoints drop empty-string
 * inputs (clearing `google_event_id` after a cancel writes the
 * `TOUR_EVENT_CANCELED_PREFIX` sentinel instead), and an UNSET lead
 * FK reads back as `0` rather than null (verified live) — which is
 * why `tourLeadScope` tests `> 0` instead of a null check.
 */
export interface XanoTour {
  id: number;
  created_at: number;
  registration_inquiry_id?: number | null;
  registration_summer_camp_id?: number | null;
  website_liability_waiver_id?: number | null;
  tasco_summer_visit_id?: number | null;
  /** Tour start, unix ms. */
  scheduled_at: number;
  duration_minutes: number;
  location: string;
  /** Free-form details — included in the Google Calendar invite
   *  description the parent sees, so write accordingly. */
  notes: string;
  /** "scheduled" | "completed" | "no_show" | "canceled". */
  status: string;
  /** Google Calendar event id once the invite is created; "" until
   *  then (or when Google Calendar isn't configured). After a cancel
   *  the id is preserved behind the `canceled:` sentinel — read
   *  through `liveTourEventId`. */
  google_event_id: string;
  /** Parent's RSVP from the Google invite ("accepted" | "declined" |
   *  "tentative" | "needsAction"); "" when unknown / no invite. */
  rsvp_status: string;
  /** Contact snapshot at scheduling time — the invite went to THIS
   *  email even if the lead row is edited later. */
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  student_name: string;
  /** Staff member who scheduled it (denormalized, like notes). */
  author_email: string;
  author_name: string;
}

/**
 * Prefix sentinel for a canceled tour's Google event id. Same Xano
 * constraint as the Stripe sentinels below: PATCHing ""/null silently
 * no-ops, so "clearing" the id after the Google event is deleted
 * would leave a live-looking id behind. Write `canceled:<old id>` and
 * read through `liveTourEventId`.
 */
export const TOUR_EVENT_CANCELED_PREFIX = "canceled:";

/** Normalize a stored `google_event_id` into "the live Google event
 *  id, or null" — null for empty values and the `canceled:` sentinel. */
export function liveTourEventId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (value.startsWith(TOUR_EVENT_CANCELED_PREFIX)) return null;
  return value;
}

/** Which lead (if any) a tour is linked to — reads the four FK
 *  columns through the shared `LEAD_NOTE_COLUMN` map. Null =
 *  unlinked (imported website booking with no matching lead). Xano
 *  may return an expanded relation object instead of the raw id, so
 *  coerce via `toIdOrNull`. */
export function tourLeadScope(
  tour: XanoTour
): { source: LeadNoteSource; id: number } | null {
  for (const source of LEAD_NOTE_SOURCES) {
    const id = toIdOrNull(tour[LEAD_NOTE_COLUMN[source]]);
    if (id !== null && id > 0) return { source, id };
  }
  return null;
}

/**
 * The four tour lead-FK columns with exactly one set — the write-side
 * counterpart of `tourLeadScope`. Pass null to clear every link.
 *
 * Unset columns are written as `0`, NOT null: 0 is what Xano stores
 * for an unset reference, and (verified live) PATCHing 0 actually
 * clears a previously-set column. That's what makes re-linking work —
 * writing the new source also zeroes whichever one was set before,
 * so a tour can never end up claimed by two leads.
 */
export function tourLeadFk(
  lead: { source: LeadNoteSource; id: number } | null
): Pick<
  XanoTour,
  | "registration_inquiry_id"
  | "registration_summer_camp_id"
  | "website_liability_waiver_id"
  | "tasco_summer_visit_id"
> {
  return {
    registration_inquiry_id: lead?.source === "inquiry" ? lead.id : 0,
    registration_summer_camp_id: lead?.source === "camp" ? lead.id : 0,
    website_liability_waiver_id: lead?.source === "visit" ? lead.id : 0,
    tasco_summer_visit_id: lead?.source === "tasco" ? lead.id : 0,
  };
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
      const res = await fetchRetry(`${getBaseUrl()}/registration_parents`);
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /** Find the parent whose stored phone matches a raw inbound number
     *  (any format). Used by the Twilio webhook to resolve a texter →
     *  parent → family. Compares on the bare 10-digit form since
     *  storage strips non-digits while Twilio sends E.164. Returns null
     *  on no match / bad input rather than throwing — the webhook still
     *  logs the inbound text even when it can't attribute it. */
    async findByPhone(rawPhone: string): Promise<XanoParent | null> {
      const norm = (s: string) => {
        const d = (s ?? "").replace(/\D/g, "");
        return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
      };
      const target = norm(rawPhone);
      if (target.length !== 10) return null;
      try {
        const all = await this.getAll();
        return all.find((p) => norm(p.phone ?? "") === target) ?? null;
      } catch {
        return null;
      }
    },

    async getById(id: number): Promise<XanoParent> {
      // fetchRetry — this call sits on the sign-in critical path (family
      // GET → resolveParents), where a single transient Xano failure
      // used to strand parents on a loading screen.
      const res = await fetchRetry(`${getBaseUrl()}/registration_parents/${id}`);
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
      // A Clerk account can end up with DUPLICATE parent rows (races on
      // first sign-in / historical webhook double-fires). The family row
      // links to only one of them — in practice the OLDEST — so when
      // multiple rows match we return the lowest id instead of whichever
      // row Xano happens to list first. Picking the wrong duplicate made
      // ownership guards resolve "no family" and 403 real parents (seen
      // live: clerk user with parent rows 195+196, family linked to 195,
      // Xano returned 196 first).
      const pick = (items: XanoParent[]): XanoParent | null => {
        const matches = items.filter((p) => p.clerk_user_id === clerkUserId);
        if (matches.length === 0) return null;
        return matches.reduce((a, b) => (a.id <= b.id ? a : b));
      };
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_parents?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          // Fallback to full scan if query param not supported
          return pick(await this.getAll());
        }
        const results: XanoParent[] = await res.json();
        return pick(Array.isArray(results) ? results : []);
      } catch {
        return pick(await this.getAll());
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
      const res = await fetchRetry(`${getBaseUrl()}/registration_families`);
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
      // COMPOSED from three plain table reads — NOT a dedicated Xano
      // query. This used to hit `/registration_families_all_details`,
      // but that custom endpoint no longer exists on the workspace
      // (404), which silently broke every consumer: the admin
      // families list 500'd, and the group-SMS audience + send saw
      // zero families (their catch() turned the throw into an empty
      // list). Joining `registration_families` + `registration_parents`
      // + `registration_application` in code reproduces the exact
      // same shape from endpoints that are load-bearing everywhere
      // else, so this can't silently regress again if a custom Xano
      // query is renamed or deleted.
      const [families, parents, apps] = await Promise.all([
        this.getAll(),
        xano.parents.getAll(),
        xano.applications.getAll(),
      ]);
      const parentById = new Map(parents.map((p) => [p.id, p]));
      const appsByFamily = new Map<number, XanoApplication[]>();
      for (const a of apps) {
        const fid = Number(a.registration_families_id);
        if (!Number.isFinite(fid) || fid <= 0) continue;
        const list = appsByFamily.get(fid) ?? [];
        list.push(a);
        appsByFamily.set(fid, list);
      }
      return families.map((fam) => ({
        id: fam.id,
        created_at: fam.created_at,
        family_name: fam.family_name ?? "",
        registration_students_id: appsByFamily.get(fam.id) ?? [],
        // Full parent rows in the family's own FK order — preserves
        // the "index 0 = primary" convention consumers rely on.
        registration_parents_id: extractIds(fam.registration_parents_id)
          .map((id) => parentById.get(id))
          .filter((p): p is XanoParent => p != null),
        registration_emergency_contacts_id: extractIds(
          (fam as { registration_emergency_contacts_id?: unknown[] })
            .registration_emergency_contacts_id ?? []
        ),
      }));
    },

    async getById(id: number): Promise<XanoFamily> {
      // fetchRetry — the family GET route depends on this on every
      // signed-in page load; retry transient failures instead of
      // surfacing them.
      const res = await fetchRetry(`${getBaseUrl()}/registration_families/${id}`);
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

    /** Hard-delete a `registration_students` row. Admin-only, used by
     *  the "Delete student" affordance to fully remove a student (the
     *  caller deletes the student's own applications + packets first,
     *  each scoped to this student by id). No soft-delete here — use the
     *  Unenroll flow (`isArchived`) when the student is leaving but
     *  history matters. */
    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_students/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    /**
     * PATCH a student via the `2GcBXyoA` admin API group rather than
     * the default group. Used specifically for the per-document
     * admin-confirm triplet on the four required documents
     * (immunization, birth certificate, school health form,
     * transcripts) — those columns were added against the admin
     * query in that group, so writes have to go through this
     * endpoint. The default `update()` above still works for fields
     * exposed on the default group's CRUD endpoint.
     *
     * Returns the updated student row so callers can refresh local
     * state without a second fetch.
     */
    async updateOnAdminGroup(
      id: number,
      data: Partial<Omit<XanoStudent, "id" | "created_at">>
    ): Promise<XanoStudent> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/registration_students/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) {
        throw new Error(
          `Xano error ${res.status}: ${await res.text()}`
        );
      }
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
      const url = new URL(`${getBaseUrl()}/admin_family_application`);
      url.searchParams.set(
        "registration_families_id",
        String(familyId)
      );
      url.searchParams.set(
        "registration_school_years_id",
        String(yearId)
      );
      // Retry + THROW on failure. This used to swallow every non-OK
      // response into `null`, which the API route rendered as a 404
      // ("Family detail not found") — so a transient Xano blip under
      // the family page's fan-out burst masqueraded as missing data.
      const res = await fetchRetry(url.toString());
      if (!res.ok) {
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      return (await res.json()) as XanoAdminFamilyDetail;
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
      //
      // DEFENSIVE CLIENT-SIDE FILTER (load-bearing): the Xano query
      // input `registration_families_id` on `/registration_application`
      // is currently NOT wired up — Xano returns the entire table
      // regardless of the value. Without the post-fetch filter, every
      // family would receive every other family's applications (PII
      // leak), and surfaces that index `applications[0]` as "this
      // family's first app" (waiver flow, enrollment-signing page,
      // students list) would pick whichever app happens to come first
      // in the unfiltered set — almost certainly the wrong family's.
      // Every other `getByFamilyId` / `getByFamilyAndYear` in this file
      // already filters client-side for the same reason; this one was
      // the lone exception and the cause of cross-family pollution on
      // the enrollment-signing flow. `toIdOrNull` handles the case
      // where Xano returns `registration_families_id` as an expanded
      // relation object (e.g. `{ id: 60, ... }`) rather than a scalar.
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all
            .filter((a) => toIdOrNull(a.registration_families_id) === familyId)
            .sort((a, b) => a.id - b.id);
        }
        const results: XanoApplication[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items
          .filter((a) => toIdOrNull(a.registration_families_id) === familyId)
          .sort((a, b) => a.id - b.id);
      } catch {
        const all = await this.getAll();
        return all
          .filter((a) => toIdOrNull(a.registration_families_id) === familyId)
          .sort((a, b) => a.id - b.id);
      }
    },

    /**
     * Active applications for a family + year, with the student,
     * family, school year, and (optional) opportunity-scholarship
     * rows already joined in via Xano addons. Hits the
     * `registration_application_by_family` query on the `2GcBXyoA`
     * API group — different group than the rest of the client, so
     * we construct the host root explicitly via `getXanoHost()`.
     *
     * Used by the acceptance-summary PDF: a single fetch covers
     * every per-app value plus the surrounding labels (student
     * names, family name, school-year amounts) the report needs
     * to render. Saves the older flow of stitching multiple
     * separate fetches together client-side.
     *
     * Returns `[]` on any network or auth error rather than
     * throwing — the PDF helper tolerates an empty list and the
     * caller can decide how to surface the failure.
     */
    async getActiveByFamilyAndYearWithDetails(
      familyId: number,
      yearId: number
    ): Promise<XanoApplicationByFamily[]> {
      try {
        const url = new URL(
          `${getXanoHost()}/api:2GcBXyoA/registration_application_by_family`
        );
        url.searchParams.set(
          "registration_families_id",
          String(familyId)
        );
        url.searchParams.set(
          "registration_school_years_id",
          String(yearId)
        );
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return [];
        const body = (await res.json()) as XanoApplicationByFamily[];
        return Array.isArray(body) ? body : [];
      } catch {
        return [];
      }
    },

    /**
     * Lean, server-side-filtered application list for a family + year
     * — the FAST path that avoids `getByFamilyId`'s full-table
     * download. Hits the same `registration_application_by_family`
     * custom query as `getActiveByFamilyAndYearWithDetails` (whose
     * filter inputs Xano actually applies, unlike the auto-CRUD
     * `?registration_families_id=` input on the default group, which
     * Xano silently ignores), and narrows the return to the base
     * `XanoApplication` shape for callers that only need the row
     * (ownership checks), not the joined student/family/year details.
     *
     * NOTE: the underlying query is `isActive=true`-only and may drop
     * legacy null-`isActive` rows, so an ownership check that misses
     * here MUST fall back to `getByFamilyId` — `findOwnedApp` does
     * exactly that.
     */
    async getByFamilyAndYear(
      familyId: number,
      yearId: number
    ): Promise<XanoApplication[]> {
      return this.getActiveByFamilyAndYearWithDetails(familyId, yearId);
    },

    /**
     * Resolve the single application `appId` that belongs to
     * `familyId` — the ownership gate for the PandaDoc routes. When a
     * `yearId` is known it tries the server-side-filtered
     * `getByFamilyAndYear` first (fast — no full-table download) and
     * only falls back to the unfiltered `getByFamilyId` on a miss.
     * The fallback is load-bearing: it covers both the active-only
     * year query dropping a legacy row and callers that pass no year,
     * so switching to the fast path can never lock a parent out of a
     * document they legitimately own. Returns `null` when the app
     * isn't the family's — callers map that to a 404.
     */
    async findOwnedApp(
      familyId: number,
      appId: number,
      yearId?: number | null
    ): Promise<XanoApplication | null> {
      if (yearId) {
        const scoped = await this.getByFamilyAndYear(familyId, yearId);
        const hit = scoped.find((a) => Number(a.id) === appId);
        if (hit) return hit;
      }
      const all = await this.getByFamilyId(familyId);
      return all.find((a) => Number(a.id) === appId) ?? null;
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
      const res = await fetchRetry(`${getBaseUrl()}/registration_school_years`);
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
      // Retried read — this is on the family page's fan-out hot path,
      // where one transient Xano failure used to surface as a 500.
      const res = await fetchRetry(url.toString());
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
      // Retried read — same fan-out hot path as the award brackets.
      const res = await fetchRetry(url.toString());
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
      const raw = (await res.json()) as Record<string, unknown>;
      // Xano's single-row endpoint now returns a composite shape:
      //   { opportunity_scholarship: {...}, homes, vehicles,
      //     contributing_members, benefits }
      // Existing callers expect the flat scholarship row back, so we
      // unwrap when the addon shape is present. New callers that want
      // the children too should use `getByIdWithChildren` below
      // instead of unpacking the wrapped result twice.
      if (
        raw &&
        typeof raw === "object" &&
        raw.opportunity_scholarship &&
        typeof raw.opportunity_scholarship === "object"
      ) {
        return raw.opportunity_scholarship as XanoScholarship;
      }
      return raw as unknown as XanoScholarship;
    },

    /**
     * Fetch a scholarship + every child row Xano joins on the
     * single-row endpoint in one call. Mirrors the live Xano response
     * shape:
     *   { opportunity_scholarship, homes, vehicles,
     *     contributing_members, benefits }
     *
     * Use this instead of stitching together separate
     * `getByScholarshipId` calls for each child table — Xano's
     * auto-generated child list endpoints don't honor arbitrary FK
     * predicates and we'd otherwise need to apply per-table
     * client-side filters anyway. One round trip, single source of
     * truth, no risk of one filter drifting from the others.
     */
    async getByIdWithChildren(id: number): Promise<{
      scholarship: XanoScholarship;
      homes: XanoScholarshipHome[];
      vehicles: XanoScholarshipVehicle[];
      contributing_members: XanoScholarshipContributingMember[];
      benefits: XanoScholarshipBenefit[];
    }> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>;
      // Defensive across both response shapes — older callers may
      // still see the flat-row endpoint while the schema change
      // ripples through, so we tolerate either:
      //   - `{ opportunity_scholarship: {...}, homes: [...], ... }`
      //   - `{ ...flatXanoScholarshipFields }`
      const scholarship =
        raw.opportunity_scholarship &&
        typeof raw.opportunity_scholarship === "object"
          ? (raw.opportunity_scholarship as XanoScholarship)
          : (raw as unknown as XanoScholarship);
      const homes = Array.isArray(raw.homes)
        ? (raw.homes as XanoScholarshipHome[])
        : [];
      const vehicles = Array.isArray(raw.vehicles)
        ? (raw.vehicles as XanoScholarshipVehicle[])
        : [];
      const contributing_members_raw = Array.isArray(raw.contributing_members)
        ? (raw.contributing_members as Record<string, unknown>[])
        : [];
      // Run each member through the PK normalizer so callers can
      // keep reading `member.id` even when Xano hands back the
      // custom-named primary key column on this addon shape.
      const contributing_members = contributing_members_raw.map(
        normalizeContributingMemberPK
      );
      const benefits = Array.isArray(raw.benefits)
        ? (raw.benefits as XanoScholarshipBenefit[])
        : [];
      return {
        scholarship,
        homes,
        vehicles,
        contributing_members,
        benefits,
      };
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

    /**
     * Delete a scholarship row by id. Callers MUST delete the
     * scholarship's children (contributing members, homes, vehicles,
     * benefits) first, otherwise Xano will reject the delete on FK
     * constraint.
     */
    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
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

    /** Single row by id — used by the scholarship-item ownership guard. */
    async getById(id: number): Promise<XanoScholarshipBenefit | null> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<XanoScholarshipBenefit>;
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

    /** Single row by id — used by the ownership guard on the parent +
     *  admin mutate routes to resolve the row's parent scholarship.
     *  Returns null on 404 so callers can 404 cleanly. */
    async getById(id: number): Promise<XanoScholarshipContributingMember | null> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, unknown>;
      return normalizeContributingMemberPK(raw);
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

    /** Single row by id — used by the scholarship-item ownership guard. */
    async getById(id: number): Promise<XanoScholarshipHome | null> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<XanoScholarshipHome>;
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
        // ALWAYS filter client-side — Xano's auto-generated GET on a
        // child table treats query params as auxiliary filters, not
        // as the listing predicate. When the param is something Xano
        // doesn't recognize as a built-in (e.g. just the FK column
        // name), the response is the FULL table — every home for
        // every scholarship in the system. Without this filter, the
        // admin Financial Aid view would surface other families'
        // homes alongside the one we want.
        //
        // Mirrors the same defense on
        // `scholarshipContributingMembers.getByScholarshipId` — same
        // Xano shape, same trap.
        return Array.isArray(results)
          ? results.filter(
              (h) =>
                h.registration_opportunity_scholarship_id === scholarshipId
            )
          : [];
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

    /** Single row by id — used by the scholarship-item ownership guard. */
    async getById(id: number): Promise<XanoScholarshipVehicle | null> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<XanoScholarshipVehicle>;
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
        // Same client-side filter as the homes helper above — Xano's
        // auto-generated child-table GET ignores arbitrary FK
        // predicates and returns the full table, so the parent
        // `?registration_opportunity_scholarship_id=X` is silently
        // dropped. Filter here so callers can't surface another
        // family's vehicles even when Xano hands them over.
        return Array.isArray(results)
          ? results.filter(
              (v) =>
                v.registration_opportunity_scholarship_id === scholarshipId
            )
          : [];
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
    /**
     * Family-payment row from the `2GcBXyoA` admin API group. Hits
     * `registration_families_payment_by_family` which returns the
     * raw row plus addons (none today, but the endpoint is on the
     * admin group alongside other addon-bearing queries we use).
     *
     * Distinct from `getByFamilyAndYear` below — that one targets
     * the default group's `registration_families_payment` CRUD
     * endpoint. Use this admin-group variant when the consumer
     * wants the canonical row for display surfaces (the
     * registration detail page's Tuition card) so we don't drift
     * if the two groups ever expose different addons.
     */
    async getByFamilyAndYearOnAdminGroup(
      familyId: number,
      yearId: number
    ): Promise<XanoFamilyPayment | null> {
      try {
        const url = new URL(
          `${getXanoHost()}/api:2GcBXyoA/registration_families_payment_by_family`
        );
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
        const body = await res.json();
        // Endpoint returns an array even when filtered to a single
        // (family, year) — be defensive about either shape.
        const items = Array.isArray(body) ? body : [body];
        const match = (items as Record<string, unknown>[]).find(
          (p) =>
            Number(p.registration_families_id) === familyId &&
            Number(p.registration_school_years_id) === yearId
        );
        return match ? normalizeFamilyPaymentPK(match) : null;
      } catch {
        return null;
      }
    },

    /**
     * Every `family_payment` row for a given school year. Backs the
     * admin Billing list — we filter client-side to rows with a
     * `stripe_subscription_id` set so the list only shows families
     * who've finished payment setup. Returns `[]` on transport
     * failures so the page degrades to an empty state rather than
     * exploding.
     */
    async getAllByYear(yearId: number): Promise<XanoFamilyPayment[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_families_payment?registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        if (!Array.isArray(results)) return [];
        return (results as Record<string, unknown>[])
          .filter(
            (p) => Number(p.registration_school_years_id) === yearId
          )
          .map((p) => normalizeFamilyPaymentPK(p));
      } catch (err) {
        console.error(
          `[xano.familyPayments.getAllByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    async getByFamilyAndYear(familyId: number, yearId: number): Promise<XanoFamilyPayment | null> {
      try {
        return await this.getByFamilyAndYearStrict(familyId, yearId);
      } catch {
        return null;
      }
    },

    /**
     * Throwing variant of `getByFamilyAndYear` — a transport/Xano
     * failure THROWS instead of coercing to null. Billing-critical
     * callers must use this: `startMonthlyBilling` treats null as
     * "no subscription exists yet" and CREATES one, so a swallowed
     * transient error on the loose variant would double-subscribe
     * (and double-bill) the family. Null still means genuinely
     * not-found.
     */
    async getByFamilyAndYearStrict(
      familyId: number,
      yearId: number
    ): Promise<XanoFamilyPayment | null> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_payment?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(
          `Xano error ${res.status} loading family payment (family=${familyId}, year=${yearId}): ${await res.text()}`
        );
      }
      const results = await res.json();
      const items = Array.isArray(results) ? results : [results];
      const match = (items as Record<string, unknown>[]).find(
        (p) =>
          p.registration_families_id === familyId &&
          p.registration_school_years_id === yearId
      );
      return match ? normalizeFamilyPaymentPK(match) : null;
    },

    async create(data: Omit<XanoFamilyPayment, "id" | "created_at">): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>;
      return normalizeFamilyPaymentPK(raw);
    },

    async update(id: number, data: Partial<Omit<XanoFamilyPayment, "id" | "created_at">>): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>;
      return normalizeFamilyPaymentPK(raw);
    },

    /**
     * Delete the legacy `registration_families_payment` row by id.
     * Used by the admin family-application cascade delete to wipe
     * the per-(family, year) payment snapshot when an application
     * is being removed end-to-end.
     */
    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /**
   * Stripe invoice mirror. Backs the admin billing aggregation
   * surfaces so we don't have to call Stripe per-family per page
   * load. Webhook handler upserts on the four invoice events;
   * backfill endpoint pulls history for invoices that landed before
   * the mirror existed.
   *
   * `findByStripeId` is the upsert workhorse — the webhook reads it
   * first to decide create-vs-update.
   */
  paymentTransactions: {
    /**
     * Lookup by Stripe invoice id — the natural key for webhook
     * upserts. Returns null when no row exists yet (first time
     * we've seen this invoice).
     */
    async findByStripeId(
      stripeInvoiceId: string
    ): Promise<XanoPaymentTransaction | null> {
      try {
        return await this.findByStripeIdStrict(stripeInvoiceId);
      } catch {
        return null;
      }
    },

    /**
     * Throwing variant of `findByStripeId` — transport/Xano failures
     * THROW instead of coercing to null. The webhook upsert must use
     * this: null there means "invoice never mirrored → CREATE", so a
     * swallowed transient error would insert a duplicate mirror row
     * for the same invoice. Throwing lets the webhook 500 so Stripe
     * retries the event instead.
     */
    async findByStripeIdStrict(
      stripeInvoiceId: string
    ): Promise<XanoPaymentTransaction | null> {
      const res = await fetch(
        `${getBaseUrl()}/registration_payment_transactions?stripe_invoice_id=${encodeURIComponent(stripeInvoiceId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(
          `Xano error ${res.status} looking up payment transaction ${stripeInvoiceId}: ${await res.text()}`
        );
      }
      const results = await res.json();
      const items = Array.isArray(results) ? results : [results];
      const match = (items as XanoPaymentTransaction[]).find(
        (r) => r.stripe_invoice_id === stripeInvoiceId
      );
      return match ?? null;
    },

    /**
     * Every transaction for a (family, year). Used by the per-
     * family billing page to render the 12-month schedule —
     * caller slots each row into the appropriate calendar month
     * via `period_start`.
     */
    async getByFamilyAndYear(
      familyId: number,
      yearId: number
    ): Promise<XanoPaymentTransaction[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_payment_transactions?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        if (!Array.isArray(results)) return [];
        return (results as XanoPaymentTransaction[]).filter(
          (r) =>
            Number(r.registration_families_id) === familyId &&
            Number(r.registration_school_years_id) === yearId
        );
      } catch (err) {
        console.error(
          `[xano.paymentTransactions.getByFamilyAndYear] threw for (${familyId}, ${yearId}):`,
          err
        );
        return [];
      }
    },

    /**
     * Every transaction across all families for a given year.
     * Backs the /admin/billing list's paid/outstanding aggregation
     * — one query, then we reduce per-family in memory. Avoids the
     * N+1 stripe API path entirely.
     */
    async getAllByYear(
      yearId: number
    ): Promise<XanoPaymentTransaction[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_payment_transactions?registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        if (!Array.isArray(results)) return [];
        return (results as XanoPaymentTransaction[]).filter(
          (r) => Number(r.registration_school_years_id) === yearId
        );
      } catch (err) {
        console.error(
          `[xano.paymentTransactions.getAllByYear] threw for yearId=${yearId}:`,
          err
        );
        return [];
      }
    },

    async create(
      data: Omit<XanoPaymentTransaction, "id" | "created_at">
    ): Promise<XanoPaymentTransaction> {
      const res = await fetch(
        `${getBaseUrl()}/registration_payment_transactions`,
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
      data: Partial<Omit<XanoPaymentTransaction, "id" | "created_at">>
    ): Promise<XanoPaymentTransaction> {
      const res = await fetch(
        `${getBaseUrl()}/registration_payment_transactions/${id}`,
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
  },

  /**
   * Audit log for outbound transactional email. One row per Resend
   * send attempt (including dry runs in dev). Written by
   * `lib/emails/send.ts` as a best-effort tail call — log failures
   * never fail the email send itself. Surfaced by the admin
   * "Sent emails" section on the family registration detail page.
   *
   * See `XanoEmailNotification` interface for the table schema.
   */
  emailNotifications: {
    /** Stamp webhook-reported state (e.g. `opened_at`) onto one audit
     *  row. */
    async update(
      id: number,
      patch: Partial<XanoEmailNotification>
    ): Promise<XanoEmailNotification> {
      const res = await fetch(
        `${getBaseUrl()}/registration_email_notifications/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      return res.json();
    },

    /** One audit row by id, or null when it doesn't exist. Callers
     *  MUST check `registration_families_id` themselves before
     *  showing it to a parent — this does no ownership filtering.
     *  Used by the email viewer so it doesn't have to pull the
     *  family's whole history (each row can carry a stored HTML
     *  body) just to render one message. */
    async getById(id: number): Promise<XanoEmailNotification | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_email_notifications/${id}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        return await res.json();
      } catch (err) {
        console.error(
          `[xano.emailNotifications.getById] threw for id=${id}:`,
          err
        );
        return null;
      }
    },

    /** Every audit row — bulk consumers (records-request tags on the
     *  registrations list) filter by template in code. */
    async getAll(): Promise<XanoEmailNotification[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_email_notifications`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<XanoEmailNotification, "id" | "created_at">
    ): Promise<XanoEmailNotification> {
      const res = await fetch(
        `${getBaseUrl()}/registration_email_notifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) {
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      return res.json();
    },

    /** Every email row for a single family, sorted newest first.
     *  Optionally scoped to a year — pass `yearId` to filter, omit
     *  to see all years. Returns `[]` on any error so the UI gets a
     *  predictable empty state without throwing. */
    async getByFamily(
      familyId: number,
      yearId?: number
    ): Promise<XanoEmailNotification[]> {
      try {
        const params = new URLSearchParams({
          registration_families_id: String(familyId),
        });
        if (yearId) {
          params.set("registration_school_years_id", String(yearId));
        }
        const res = await fetch(
          `${getBaseUrl()}/registration_email_notifications?${params.toString()}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        if (!Array.isArray(results)) return [];
        // Defensive filter in case Xano's query-param matching isn't
        // wired on a fresh environment — same belt-and-suspenders
        // pattern other groups use.
        const filtered = (results as XanoEmailNotification[]).filter((r) => {
          if (Number(r.registration_families_id) !== familyId) return false;
          if (yearId && Number(r.registration_school_years_id) !== yearId)
            return false;
          return true;
        });
        return filtered.sort((a, b) => b.created_at - a.created_at);
      } catch (err) {
        console.error(
          `[xano.emailNotifications.getByFamily] threw for familyId=${familyId} yearId=${yearId}:`,
          err
        );
        return [];
      }
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

    /** Every contact across all families — bulk consumers (the
     *  enrolled export) group by `registration_families_id` in code. */
    async getAll(): Promise<XanoEmergencyContact[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_emergency_contacts`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
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

  volunteerHours: {
    /**
     * Every volunteer-hour entry on file for a family across every
     * school year. Hits the admin-group
     * `registration_families_volunteer_hours_by_family` endpoint so
     * the parent dashboard can render a single fetch and bucket the
     * rows by year client-side.
     *
     * Returns `[]` on any network or auth error rather than throwing
     * — the dashboard tolerates missing data and falls back to a
     * "no hours logged yet" empty state.
     */
    async getByFamily(familyId: number): Promise<XanoVolunteerHours[]> {
      try {
        const url = new URL(
          `${getXanoHost()}/api:2GcBXyoA/registration_families_volunteer_hours_by_family`
        );
        url.searchParams.set(
          "registration_families_id",
          String(familyId)
        );
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return [];
        const body = await res.json();
        return Array.isArray(body) ? (body as XanoVolunteerHours[]) : [];
      } catch {
        return [];
      }
    },

    /** Every entry across all families/years — the admin review page
     *  filters by year in code (plain CRUD endpoint, bare array). */
    async getAll(): Promise<XanoVolunteerHours[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_volunteer_hours`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<
        XanoVolunteerHours,
        "id" | "created_at" | "activity_description" | "activity_category"
      >
    ): Promise<XanoVolunteerHours> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_volunteer_hours`,
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
      patch: Partial<XanoVolunteerHours>
    ): Promise<XanoVolunteerHours> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_volunteer_hours/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_families_volunteer_hours/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** School-store catalog — see `XanoStoreItem`. Plain CRUD on
   *  `registration_store_items`. */
  storeItems: {
    async getAll(): Promise<XanoStoreItem[]> {
      const res = await fetch(`${getBaseUrl()}/registration_store_items`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<XanoStoreItem, "id" | "created_at">
    ): Promise<XanoStoreItem> {
      const res = await fetch(`${getBaseUrl()}/registration_store_items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoStoreItem>
    ): Promise<XanoStoreItem> {
      const res = await fetch(`${getBaseUrl()}/registration_store_items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_store_items/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** School-store purchases — see `XanoStoreOrder`. Plain CRUD on
   *  `registration_store_orders`; callers filter by family / session in
   *  (order volume is small). */
  storeOrders: {
    async getAll(): Promise<XanoStoreOrder[]> {
      const res = await fetch(`${getBaseUrl()}/registration_store_orders`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    /**
     * Find the order mirrored from one Checkout Session. THROWS on a
     * failed list fetch rather than returning null — the webhook uses
     * null as "never seen → CREATE", so a swallowed error would
     * duplicate the row on retry.
     */
    async findBySessionIdStrict(
      sessionId: string
    ): Promise<XanoStoreOrder | null> {
      const rows = await xano.storeOrders.getAll();
      return (
        rows.find((r) => r.stripe_checkout_session_id === sessionId) ?? null
      );
    },

    async create(
      data: Omit<XanoStoreOrder, "id" | "created_at">
    ): Promise<XanoStoreOrder> {
      const res = await fetch(`${getBaseUrl()}/registration_store_orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoStoreOrder>
    ): Promise<XanoStoreOrder> {
      const res = await fetch(`${getBaseUrl()}/registration_store_orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  /** Mirrored Google Calendar appointments — see
   *  `XanoGoogleAppointment`. Plain CRUD on `google_appointments`;
   *  callers filter by family / event id in code. */
  googleAppointments: {
    async getAll(): Promise<XanoGoogleAppointment[]> {
      const res = await fetch(`${getBaseUrl()}/registration_google_appointments`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<XanoGoogleAppointment, "id" | "created_at">
    ): Promise<XanoGoogleAppointment> {
      const res = await fetch(`${getBaseUrl()}/registration_google_appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoGoogleAppointment>
    ): Promise<XanoGoogleAppointment> {
      const res = await fetch(`${getBaseUrl()}/registration_google_appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  /** Device inventory + assignments from the staff-side operations
   *  system (Xano group `jzQ2liPL`) — see `XanoLaptop` /
   *  `XanoLaptopAssignment`. Read-mostly: this app never creates or
   *  deletes devices/assignments (the staff system owns that flow);
   *  the only write is stamping the enrolled-student bridge columns
   *  on an assignment. */
  laptops: {
    async getAll(): Promise<XanoLaptop[]> {
      const res = await fetch(`${getOpsBaseUrl()}/laptops`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
  },

  laptopAssignments: {
    async getAll(): Promise<XanoLaptopAssignment[]> {
      const res = await fetch(`${getOpsBaseUrl()}/laptop_assignments`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    /** Stamp / clear the enrolled-student bridge columns. Values of 0
     *  are real writes (unlink), not sentinels — the columns are ints
     *  and Xano int inputs accept 0. */
    async update(
      id: number,
      patch: Pick<
        XanoLaptopAssignment,
        "enrolled_students_id" | "enrolled_families_id"
      >
    ): Promise<XanoLaptopAssignment> {
      const res = await fetch(
        `${getOpsBaseUrl()}/laptop_assignments/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  studentRegistration: {
    /**
     * Every registration packet. Used by aggregate surfaces (the
     * dashboard's 30-day enrollment trend) that need confirm
     * timestamps across the whole table rather than one student's
     * row. Retried — it sits on a dashboard fan-out path.
     */
    async getAll(): Promise<XanoStudentRegistration[]> {
      const res = await fetchRetry(
        `${getBaseUrl()}/registration_student_registration`
      );
      if (!res.ok) {
        throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      }
      const items = await res.json();
      return Array.isArray(items) ? items : [];
    },

    async create(data: Omit<XanoStudentRegistration, "id" | "created_at">): Promise<XanoStudentRegistration> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /**
     * Fetch a single packet by its primary key. Used by the admin
     * PATCH route to read the current `crew_assignment` before a
     * crew change so it can snapshot the prior crew into the audit
     * columns server-side. Returns `null` on any error / 404 so the
     * caller can skip the audit stamping cleanly rather than 500.
     */
    async getById(id: number): Promise<XanoStudentRegistration | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration/${id}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
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
        // FK can come back as a scalar or an expanded `{id}` object —
        // `toIdOrNull` handles both so a Xano relation expansion can't
        // make the row "invisible" and trick resolve into creating a
        // duplicate.
        const match = items.find(
          (r: XanoStudentRegistration) =>
            toIdOrNull(r.registration_students_id) === studentId
        );
        return match ?? null;
      } catch {
        return null;
      }
    },

    /**
     * All packets for a student across every year. Used by the
     * archive cascade — when admin archives a student, we walk
     * every year's packet to take the student's Stripe item off
     * the matching subscription. Re-enrolling students have one
     * packet per year; most students will have just one (the
     * current year's) here. Returns `[]` on any error so the
     * caller can skip cleanly.
     */
    async getAllByStudentId(
      studentId: number
    ): Promise<XanoStudentRegistration[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration?registration_students_id=${studentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter(
          (r: XanoStudentRegistration) =>
            toIdOrNull(r.registration_students_id) === studentId
        );
      } catch {
        return [];
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
      const all = await this._getAllMatches(studentId, yearId);
      // Return the most-recent keeper when multiples slipped past
      // historical races; dedupe is owned by `_doResolve` so this
      // read path stays a pure read.
      if (all.length === 0) return null;
      if (all.length === 1) return all[0];
      return all.slice().sort((a, b) => {
        const aT = a.last_edited_time ?? a.created_at ?? 0;
        const bT = b.last_edited_time ?? b.created_at ?? 0;
        if (aT !== bT) return bT - aT;
        return a.id - b.id;
      })[0];
    },

    /**
     * Read every packet matching `(studentId, yearId)` without
     * deduping. Used by the resolve mutex's pre/post create checks
     * AND by `getByStudentAndYear` (which picks one keeper). FK
     * fields are normalized via `toIdOrNull` so Xano expanding a
     * relation into an object can't make rows "invisible".
     */
    async _getAllMatches(
      studentId: number,
      yearId: number
    ): Promise<XanoStudentRegistration[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration?registration_students_id=${studentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter(
          (r: XanoStudentRegistration) =>
            toIdOrNull(r.registration_students_id) === studentId &&
            toIdOrNull(r.registration_school_years_id) === yearId
        );
      } catch {
        return [];
      }
    },

    /**
     * Fetch-or-create the per (student, year) packet. Used by the
     * PandaDoc waiver routes (waiver state lives on the packet but a
     * parent may trigger the waiver before they've started filling
     * out the rest of the registration form) and by the application
     * acceptance cascade (the cascade copies billing/SUFS columns
     * onto the packet at acceptance time).
     *
     * Race-safe via an in-process mutex (`pendingProgressResolve`)
     * keyed on `studentRegistration:<studentId>:<yearId>`. Two
     * concurrent acceptance flips on the same (student, year) share
     * the in-flight promise instead of each launching their own
     * create. Post-create the resolver re-reads and, if a parallel
     * process beat us to the punch (or pre-existing dupes from
     * before this hardening), collapses the extras into a single
     * keeper. Mirrors the dedupe pattern already applied to
     * `studentRegistrationProgress.resolve` / `familyApplicationProgress.resolve`.
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
      const lockKey = `studentRegistration:${studentId}:${yearId}`;
      const inflight = pendingProgressResolve.get(lockKey);
      if (inflight) {
        return inflight as Promise<XanoStudentRegistration>;
      }
      const promise = this._doResolve(
        studentId,
        yearId,
        registration_type_id
      ).finally(() => {
        pendingProgressResolve.delete(lockKey);
      });
      pendingProgressResolve.set(lockKey, promise);
      return promise;
    },

    async _doResolve(
      studentId: number,
      yearId: number,
      registration_type_id: number
    ): Promise<XanoStudentRegistration> {
      const pre = await this._getAllMatches(studentId, yearId);
      if (pre.length === 1) return pre[0];
      if (pre.length > 1) {
        // Pre-existing duplicates from before this hardening shipped
        // — collapse without creating yet another row.
        return dedupeStudentRegistrationRows(pre, (id) => this.delete(id));
      }
      const created = await this.create({
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
      // Re-check — if a parallel process raced past us, we now have
      // multiple rows. Dedupe to a single keeper.
      const post = await this._getAllMatches(studentId, yearId);
      if (post.length <= 1) return post[0] ?? created;
      return dedupeStudentRegistrationRows(post, (id) => this.delete(id));
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
    /** Every note across all families — the latest-activity column on
     *  the list pages bulk-joins these client-of-route side. */
    async getAll(): Promise<XanoAdminNote[]> {
      const res = await fetch(`${getBaseUrl()}/registration_admin_notes`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

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
              // Family notes only — LEAD-scoped notes (inquiry, camp,
              // visit, TASCO) share the same table but live on their
              // own foreign keys. Filter them out so a stray match
              // (e.g. shared ids across tables) can't bleed into the
              // family timeline.
              .filter((n) =>
                LEAD_NOTE_SOURCES.every((s) => {
                  const v = n[LEAD_NOTE_COLUMN[s]];
                  return v == null || v === 0;
                })
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

    /** Inquiry-scoped variant. Delegates to the generic lead reader —
     *  kept as a named accessor because several callers predate the
     *  four-source lead model. */
    async getByInquiryId(inquiryId: number): Promise<XanoAdminNote[]> {
      return this.getByLead("inquiry", inquiryId);
    },

    /**
     * Notes for ONE recruitment lead, newest first. The four lead
     * sources share `registration_admin_notes`, each keyed by its own
     * nullable FK column (mutually exclusive with each other and with
     * the family/progress scopes), so a lead timeline can never bleed
     * into another's.
     *
     * The client-side re-filter is load-bearing, same as everywhere
     * else in this file: a Xano query input that isn't wired returns
     * the whole table rather than erroring.
     */
    async getByLead(
      source: LeadNoteSource,
      id: number
    ): Promise<XanoAdminNote[]> {
      const column = LEAD_NOTE_COLUMN[source];
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_admin_notes?${column}=${id}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const items: XanoAdminNote[] = await res.json();
        return Array.isArray(items)
          ? items
              .filter((n) => n[column] === id)
              .sort((a, b) => b.created_at - a.created_at)
          : [];
      } catch {
        return [];
      }
    },

    /** Every inquiry-scoped note across all inquiries, in one fetch.
     *  Powers the inquiries dashboard's "Last note" column — grouping
     *  the most-recent note per inquiry happens on the server so the
     *  table needs one round-trip, not one per row. */
    async getAllInquiryNotes(): Promise<XanoAdminNote[]> {
      const byLead = await this.getAllLeadNotes();
      return byLead.filter(
        (n) => n.registration_inquiry_id != null &&
          n.registration_inquiry_id !== 0
      );
    },

    /** Every LEAD-scoped note (all four sources) in one fetch — powers
     *  the "last contacted" columns on the recruitment lists and All
     *  Leads without one round-trip per row. Family + progress-scoped
     *  notes are filtered out. Mirrors the unfiltered-getAll
     *  assumption the rest of this file relies on (see
     *  `parents.getAll`): Xano's "Get all records" returns everything. */
    async getAllLeadNotes(): Promise<XanoAdminNote[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_admin_notes`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const items: XanoAdminNote[] = await res.json();
        return Array.isArray(items)
          ? items.filter((n) =>
              LEAD_NOTE_SOURCES.some((s) => {
                const v = n[LEAD_NOTE_COLUMN[s]];
                return v != null && v !== 0;
              })
            )
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

  smsMessages: {
    /** A family's full text thread, oldest-first (chat order). */
    async getByFamilyId(familyId: number): Promise<XanoSmsMessage[]> {
      return this.getByContact("family", familyId);
    },

    /**
     * One contact's full text thread, oldest-first — generic across
     * the four contact types (family / inquiry / summer-camp /
     * campus-visit waiver), each keyed by its own FK column on
     * `sms_messages`. Threads are never year-filtered: one continuous
     * history per contact across academic years.
     */
    async getByContact(
      type: "family" | "inquiry" | "camp" | "visit" | "tasco",
      id: number
    ): Promise<XanoSmsMessage[]> {
      const column =
        type === "family"
          ? "registration_families_id"
          : type === "inquiry"
            ? "registration_inquiry_id"
            : type === "camp"
              ? "registration_summer_camp_id"
              : type === "tasco"
                ? "tasco_summer_visit_id"
                : "website_liability_waiver_id";
      try {
        const res = await fetch(
          `${getBaseUrl()}/sms_messages?${column}=${id}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const items: XanoSmsMessage[] = await res.json();
        // Client-side filter is load-bearing (same reason as every
        // other accessor here: Xano query inputs that aren't wired
        // return the whole table).
        return Array.isArray(items)
          ? items
              .filter((m) => m[column] === id)
              // Tie-break on id: rows backfilled by the Twilio sync
              // can share one `created_at` (Xano stamps import time
              // when the Add Record endpoint doesn't accept the
              // field), and the sync inserts oldest-first — so id
              // order IS send order inside a tied batch. Without this
              // the thread's order is whatever Xano returned.
              .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
          : [];
      } catch {
        return [];
      }
    },

    /** Every SMS across all families, newest-first — powers the global
     *  inbox's conversation list (Phase 3). */
    async getAll(): Promise<XanoSmsMessage[]> {
      try {
        const res = await fetch(`${getBaseUrl()}/sms_messages`, {
          cache: "no-store",
        });
        if (!res.ok) return [];
        const items: XanoSmsMessage[] = await res.json();
        return Array.isArray(items)
          ? items
              .slice()
              // Same tie-break as `getByContact`, reversed: with a
              // batch of backfilled rows sharing one timestamp, the
              // highest id is the newest message. The inbox picks each
              // conversation's "last message" as the first row it sees
              // per contact, so an unordered tie made it show an
              // arbitrary message (and the wrong needs-reply state).
              .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
          : [];
      } catch {
        return [];
      }
    },

    /** Look up a logged message by its Twilio SID — the status-callback
     *  webhook uses this to update delivery state on the right row. */
    async findByMessageSid(sid: string): Promise<XanoSmsMessage | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/sms_messages?twilio_message_sid=${encodeURIComponent(sid)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const items: XanoSmsMessage[] = await res.json();
        return Array.isArray(items)
          ? items.find((m) => m.twilio_message_sid === sid) ?? null
          : null;
      } catch {
        return null;
      }
    },

    async create(
      // `created_at` is accepted so the Twilio backfill sync can
      // preserve each message's ORIGINAL send time instead of letting
      // Xano stamp the import moment (which is what made every
      // imported text share one clock time). Requires `created_at` as
      // an input on the Xano `POST /sms_messages` endpoint — wired
      // 2026-08-03. Omitted on live sends, where "now" is correct.
      data: Omit<XanoSmsMessage, "id" | "created_at"> & {
        created_at?: number;
      }
    ): Promise<XanoSmsMessage> {
      const res = await fetch(`${getBaseUrl()}/sms_messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const row: XanoSmsMessage = await res.json();
      // Guard against a mis-wired Add Record endpoint. Xano silently
      // DROPS inputs the endpoint doesn't declare — observed live on
      // 2026-08-03, when an endpoint edit broke the input mapping and
      // every send/sync insert landed as an all-empty row (which the
      // sync then re-imported forever, because the SID never saved).
      // If the row doesn't echo the body we sent, remove the orphan
      // and throw with the exact fix, instead of returning a "success"
      // that poisons the log.
      if (data.body && row.body !== data.body) {
        await this.delete(row.id).catch((err) => {
          console.error(
            "[xano.smsMessages.create] failed to clean up empty row:",
            err
          );
        });
        throw new Error(
          "Xano ignored the message fields on POST /sms_messages — the " +
            "Add Record endpoint's inputs are unwired. In Xano, open the " +
            "sms_messages Add Record endpoint and re-map every input " +
            "(direction, to_number, body, twilio_message_sid, …) to its " +
            "column, then retry."
        );
      }
      return row;
    },

    /** Hard-delete one row — used by the create() echo-guard above and
     *  by cleanup tooling. */
    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/sms_messages/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async update(
      id: number,
      // `created_at` is writable here only for the one-time timestamp
      // repair (`lib/sms/repair-timestamps.ts`), which restores the
      // real Twilio send time on rows the backfill stamped with the
      // import moment. Nothing else should ever set it.
      data: Partial<Omit<XanoSmsMessage, "id" | "created_at">> & {
        created_at?: number;
      }
    ): Promise<XanoSmsMessage> {
      const res = await fetch(`${getBaseUrl()}/sms_messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
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
      // Hard-guard against bad inputs at the entry point. A `null`,
      // `undefined`, `0`, or NaN here used to leak through every
      // create call and seed an orphan progress row that admin could
      // never reconcile (FK pointed at a deleted family, dedup
      // filter missed it because `null !== undefined`). Throwing
      // here forces the bug back up to the caller where it can be
      // diagnosed instead of silently corrupting the table.
      if (!Number.isInteger(familyId) || familyId <= 0) {
        throw new Error(
          `xano.familyApplicationProgress.resolve: familyId must be a positive integer (got ${String(
            familyId
          )})`
        );
      }
      if (!Number.isInteger(yearId) || yearId <= 0) {
        throw new Error(
          `xano.familyApplicationProgress.resolve: yearId must be a positive integer (got ${String(
            yearId
          )})`
        );
      }
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

      // No row yet. Before creating, verify the family actually
      // exists — calling `resolve` on a deleted family (e.g. admin
      // navigating to an orphan `/admin/families/23` list entry)
      // used to seed a fresh progress row pointing at a tombstoned
      // FK, multiplying the orphan problem on every admin visit.
      // Throw on a missing family so the bug surfaces instead of
      // compounding.
      try {
        await xano.families.getById(familyId);
      } catch {
        throw new Error(
          `xano.familyApplicationProgress.resolve: family ${familyId} does not exist — refusing to create an orphan progress row`
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

    /** Every progress row across all families and years — backs the
     *  All Leads conversion funnel, which needs "has this family ever
     *  applied, any year" rather than a per-year slice. The plain
     *  CRUD endpoint returns the whole table (the query params on the
     *  `_getAllMatches` URL above are ignored server-side — filtering
     *  happens in code there too). Fail-soft like the other bulk
     *  reads: a Xano blip degrades the funnel to "no data" instead of
     *  500ing the leads list. */
    async getAll(): Promise<XanoFamilyApplicationProgress[]> {
      try {
        const res = await fetchRetry(
          `${getBaseUrl()}/registration_family_application_progress`
        );
        if (!res.ok) return [];
        const items = await res.json();
        return Array.isArray(items) ? items : [];
      } catch {
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

  // `reapplyFamilyProgress` retired — the re-application flow now writes
  // to `familyApplicationProgress` (above) with `type: "Re-Enrollment"`
  // and `testing_completed: true` stamped at bootstrap. The legacy
  // `reapply_family_progress` Xano table is no longer read or written
  // by the app; the column survives on Xano for any historical record
  // but admin tooling treats both flows as a single apply pipeline.

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
      // Same input guard as `familyApplicationProgress.resolve` —
      // refuse to seed an orphan row from a `null` / `undefined` /
      // `0` / NaN familyId. See that resolver for the full
      // rationale; this hard-throw stops the leak at the source.
      if (!Number.isInteger(familyId) || familyId <= 0) {
        throw new Error(
          `xano.studentRegistrationProgress.resolve: familyId must be a positive integer (got ${String(
            familyId
          )})`
        );
      }
      if (!Number.isInteger(yearId) || yearId <= 0) {
        throw new Error(
          `xano.studentRegistrationProgress.resolve: yearId must be a positive integer (got ${String(
            yearId
          )})`
        );
      }
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

      // No row yet. Verify the family exists before creating —
      // admin navigating to an orphan `/admin/families/23` URL used
      // to seed a fresh registration-progress row pointing at a
      // tombstoned FK on every visit. Throwing on a missing family
      // surfaces the bug instead of compounding orphans.
      try {
        await xano.families.getById(familyId);
      } catch {
        throw new Error(
          `xano.studentRegistrationProgress.resolve: family ${familyId} does not exist — refusing to create an orphan progress row`
        );
      }

      // Create the row.
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

  websiteWaivers: {
    /** Campus-visit liability waivers signed on the marketing site
     *  (`website_liability_waiver` — public form, no auth). Fail-soft
     *  like the other read accessors. */
    async getAll(): Promise<XanoWebsiteLiabilityWaiver[]> {
      try {
        const res = await fetchRetry(`${getBaseUrl()}/website_liability_waiver`);
        if (!res.ok) return [];
        const items: XanoWebsiteLiabilityWaiver[] = await res.json();
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    },

    /** Admin writes (All Leads star rating). Requires the standard
     *  Xano PATCH endpoint on `website_liability_waiver` — throws with
     *  the Xano status if it isn't wired yet. */
    async update(
      id: number,
      patch: Partial<XanoWebsiteLiabilityWaiver>
    ): Promise<XanoWebsiteLiabilityWaiver> {
      const res = await fetch(
        `${getBaseUrl()}/website_liability_waiver/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  tascoSummerVisits: {
    /** TASCO summer-visit sign-ups (`tasco_summer_visit`). Lives on the
     *  `2GcBXyoA` API group rather than the one `XANO_API_BASE_URL`
     *  points at, so it's reached via `getXanoHost()` — same approach
     *  the `registration_students` admin-group accessor uses, and it
     *  avoids a second env var. Fail-soft like the other read
     *  accessors: a Xano blip degrades the page to empty instead of
     *  500-ing it. */
    async getAll(): Promise<XanoTascoSummerVisit[]> {
      try {
        const res = await fetchRetry(
          `${getXanoHost()}/api:2GcBXyoA/tasco_summer_visit`
        );
        if (!res.ok) return [];
        const items: XanoTascoSummerVisit[] = await res.json();
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    },

    /** Admin writes (All Leads star rating). Same `2GcBXyoA` group as
     *  the read; requires the standard PATCH endpoint on
     *  `tasco_summer_visit` — throws with the Xano status if it isn't
     *  wired yet. */
    async update(
      id: number,
      patch: Partial<XanoTascoSummerVisit>
    ): Promise<XanoTascoSummerVisit> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/tasco_summer_visit/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  summerCamp: {
    async getAll(): Promise<XanoSummerCampInquiry[]> {
      const res = await fetchRetry(`${getBaseUrl()}/registration_summer_camp`);
      if (!res.ok) return [];
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoSummerCampInquiry>
    ): Promise<XanoSummerCampInquiry> {
      const res = await fetch(
        `${getBaseUrl()}/registration_summer_camp/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  inquiries: {
    async getAll(): Promise<XanoInquiry[]> {
      const res = await fetchRetry(`${getBaseUrl()}/registration_inquiry`);
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

  /** School calendar days — see `XanoSchoolCalendarDay`. */
  schoolCalendar: {
    /** Every day row across all years — used by cleanup paths that
     *  can't know the year (e.g. clearing a deleted season's day
     *  assignments). */
    async getAll(): Promise<XanoSchoolCalendarDay[]> {
      const res = await fetch(`${getBaseUrl()}/school_calendar`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows: XanoSchoolCalendarDay[] = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    /** Every day row for one school year. The plain endpoint has no
     *  year filter, so we scan and filter in code — ~365 rows per
     *  year keeps this cheap. */
    async getByYear(yearId: number): Promise<XanoSchoolCalendarDay[]> {
      const res = await fetch(`${getBaseUrl()}/school_calendar`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows: XanoSchoolCalendarDay[] = await res.json();
      return Array.isArray(rows)
        ? rows.filter((r) => Number(r.schoolyears_id) === yearId)
        : [];
    },

    async update(
      id: number,
      patch: Partial<XanoSchoolCalendarDay>
    ): Promise<XanoSchoolCalendarDay> {
      const res = await fetch(`${getBaseUrl()}/school_calendar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  /** Events pinned to calendar days — see `XanoSchoolCalendarEvent`. */
  schoolCalendarEvents: {
    async getAll(): Promise<XanoSchoolCalendarEvent[]> {
      const res = await fetch(`${getBaseUrl()}/school_calendar_events`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<XanoSchoolCalendarEvent, "id" | "created_at">
    ): Promise<XanoSchoolCalendarEvent> {
      const res = await fetch(`${getBaseUrl()}/school_calendar_events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoSchoolCalendarEvent>
    ): Promise<XanoSchoolCalendarEvent> {
      const res = await fetch(`${getBaseUrl()}/school_calendar_events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/school_calendar_events/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** Family RSVPs to calendar events — see `XanoEventRsvp`. Plain
   *  CRUD on `school_event_rsvps`; callers filter by event /
   *  family in code. */
  eventRsvps: {
    async getAll(): Promise<XanoEventRsvp[]> {
      const res = await fetch(`${getBaseUrl()}/school_event_rsvps`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },

    async create(
      data: Omit<XanoEventRsvp, "id" | "created_at">
    ): Promise<XanoEventRsvp> {
      const res = await fetch(`${getBaseUrl()}/school_event_rsvps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(
      id: number,
      patch: Partial<XanoEventRsvp>
    ): Promise<XanoEventRsvp> {
      const res = await fetch(
        `${getBaseUrl()}/school_event_rsvps/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/school_event_rsvps/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** Academic terms — see `XanoAcademicTerm`. NOTE: unlike the older
   *  plain tables, this list endpoint wraps rows as `{ value, Count }`
   *  — the accessor unwraps either shape. */
  academicTerms: {
    async getByYear(yearId: number): Promise<XanoAcademicTerm[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_terms`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const rows: XanoAcademicTerm[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : [];
      return rows.filter(
        (r) => Number(r.registration_school_years_id) === yearId
      );
    },

    async create(
      data: Omit<XanoAcademicTerm, "id" | "created_at">
    ): Promise<XanoAcademicTerm> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_terms`,
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
      patch: Partial<XanoAcademicTerm>
    ): Promise<XanoAcademicTerm> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_terms/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_terms/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** Academic seasons — see `XanoAcademicSeason`. Same wrapped list
   *  shape as `academicTerms`. */
  academicSeasons: {
    async getByYear(yearId: number): Promise<XanoAcademicSeason[]> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_seasons`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const rows: XanoAcademicSeason[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : [];
      return rows.filter(
        (r) => Number(r.registration_school_years_id) === yearId
      );
    },

    async create(
      data: Omit<XanoAcademicSeason, "id" | "created_at">
    ): Promise<XanoAcademicSeason> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_seasons`,
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
      patch: Partial<XanoAcademicSeason>
    ): Promise<XanoAcademicSeason> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_seasons/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getBaseUrl()}/registration_academic_seasons/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  /** Scheduled campus tours — see `XanoTour`. NOTE: the table lives
   *  on the `2GcBXyoA` API group (like `tasco_summer_visit`), so
   *  every call goes through `getXanoHost()` rather than the base
   *  group URL. */
  tours: {
    /** Every tour, newest-scheduled first. Fail-soft like the other
     *  recruitment reads — a Xano blip (or the table not existing yet)
     *  degrades the Tours surfaces to empty instead of 500-ing them. */
    async getAll(): Promise<XanoTour[]> {
      try {
        const res = await fetchRetry(
          `${getXanoHost()}/api:2GcBXyoA/registration_tours`
        );
        if (!res.ok) return [];
        const rows: XanoTour[] = await res.json();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },

    async getById(id: number): Promise<XanoTour> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/registration_tours/${id}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async create(
      data: Omit<XanoTour, "id" | "created_at">
    ): Promise<XanoTour> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/registration_tours`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, patch: Partial<XanoTour>): Promise<XanoTour> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/registration_tours/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(
        `${getXanoHost()}/api:2GcBXyoA/registration_tours/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },
};

/**
 * Prefix sentinel for a canceled subscription id on
 * `registration_families_payment.stripe_subscription_id`.
 *
 * Why a sentinel and not null: Xano's edit endpoints IGNORE null/empty
 * inputs (field mapping is conditional on "not empty"), so writing
 * `stripe_subscription_id: null` after a cancellation silently no-ops
 * and the stale live-looking id blocks the family from ever being
 * re-billed. The webhook writes `canceled:<old id>` instead — a real
 * write that also preserves the history of which subscription ended.
 */
export const STRIPE_SUB_CANCELED_PREFIX = "canceled:";

/**
 * Normalize a stored `stripe_subscription_id` into "the live
 * subscription id, or null". Returns null for empty values AND for
 * the `canceled:` sentinel above. EVERY consumer that asks "does this
 * family have a subscription?" must go through this helper — reading
 * the raw column treats a canceled sentinel as a live subscription.
 */
export function activeStripeSubscriptionId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (value.startsWith(STRIPE_SUB_CANCELED_PREFIX)) return null;
  return value;
}

/**
 * Prefix sentinel for a removed per-student SubscriptionItem handle on
 * `registration_student_registration.stripe_subscription_item_id`.
 * Same Xano constraint as the subscription-id sentinel above: PATCHing
 * null/empty silently no-ops, so "clearing" the handle with null left
 * the stale item id in place — which made the billing reconcile treat
 * the student as already-billing and skip them forever. Write
 * `removed:<old id>` instead and read through
 * `liveStripeSubscriptionItemId`.
 */
export const STRIPE_ITEM_REMOVED_PREFIX = "removed:";

/** Normalize a stored `stripe_subscription_item_id` into "the live
 *  item id, or null". Null for empty values and the `removed:`
 *  sentinel. Every consumer that asks "is this student on the
 *  subscription?" must read through this. */
export function liveStripeSubscriptionItemId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (value.startsWith(STRIPE_ITEM_REMOVED_PREFIX)) return null;
  return value;
}
