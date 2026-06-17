import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoEmergencyContact,
  XanoFamily,
  XanoParent,
  XanoStudent,
  XanoStudentRegistration,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/**
 * Admin GET — aggregated family registration view.
 *
 * Returns everything the family-focused registration detail page
 * needs to render the four packet section cards (Tuition / Enrollment
 * Agreement / Registration Packet / Volunteer Hours) including the
 * full per-student packet contents (sizes, medical, file uploads,
 * waiver state) and the family's emergency contacts roster.
 *
 * Strategy:
 *   - `admin_family_application` aggregate gives us family + parents
 *     + students + apps for the year in one call
 *   - Family-level `registration_student_registration_progress` row
 *     holds the four packet booleans + tuition / enrollment-agreement
 *     fields; resolved-or-created so the page renders even before
 *     the parent has touched a single section
 *   - Per-student `registration_student_registration` packets pulled
 *     for the year and joined to active applications. We surface the
 *     ENTIRE packet shape (not just confirmation state) so the page
 *     can render the parent-facing form as a read-only summary —
 *     mirrors the application page's "view what the parent sees"
 *     pattern.
 *   - Emergency contacts pulled by family id since they're family-
 *     scoped, not per-student
 *
 * Each lookup is wrapped in try/catch and missing data falls back to
 * sensible defaults so a single Xano hiccup never 500s the page.
 *
 * URL: `/api/admin/registrations/[familyId]?yearId=X`
 *   (the `[id]` param is the family id — we mirror the
 *   `/admin/families/[id]` URL shape so the dynamic segment is the
 *   thing humans navigate to)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      );
    }

    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [
      aggResult,
      progressResult,
      packetsResult,
      parentsResult,
      studentsResult,
      emergencyResult,
      paymentResult,
      scholarshipResult,
      familyRowResult,
    ] = await Promise.allSettled([
      xano.applications.getAdminFamilyDetail(familyId, yearId),
      xano.studentRegistrationProgress.resolve(familyId, yearId),
      xano.studentRegistration.getByYear(yearId),
      xano.parents.getAll(),
      xano.students.getAll(),
      xano.emergencyContacts.getByFamilyId(familyId),
      // Legacy `registration_families_payment` row — pulled here as a
      // fallback for the Tuition card's monthly snapshot. The Approve
      // flow snapshots the monthly tuition + transport onto BOTH this
      // legacy row and the registration progress row, but families
      // approved before the dual-write fix landed only carry the
      // amounts on this legacy row. Reading both lets us paper over
      // that delta until the legacy table is fully retired.
      xano.familyPayments.getByFamilyAndYear(familyId, yearId),
      // Scholarship row — needed to know whether the family is on the
      // SNAP path (and whether the SNAP award letter has been admin-
      // confirmed). The per-student tuition breakdown table renders
      // the Opportunity Scholarship coverage as a computed value when
      // SNAP-confirmed (covers tuition + transport - SUFS) instead of
      // reading the per-app `opportunity_scholarship_award_amount`
      // column, which is null for SNAP families on purpose.
      xano.scholarship.getByFamilyAndYear(familyId, yearId),
      // Direct family-row fetch — the `admin_family_application`
      // aggregate may omit newer columns, so read `is_residential`
      // straight off the raw family row to be safe.
      xano.families.getById(familyId),
    ]);

    if (aggResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] admin_family_application failed:",
        aggResult.reason
      );
    }
    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] family progress resolve failed:",
        progressResult.reason
      );
    }
    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] student packets failed:",
        packetsResult.reason
      );
    }
    if (emergencyResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] emergency contacts failed:",
        emergencyResult.reason
      );
    }
    if (paymentResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] family payment fallback failed:",
        paymentResult.reason
      );
    }

    const agg =
      aggResult.status === "fulfilled" ? aggResult.value : null;
    const progress =
      progressResult.status === "fulfilled" ? progressResult.value : null;
    const allPackets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const studentsAll =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const emergencyContacts =
      emergencyResult.status === "fulfilled" ? emergencyResult.value : [];
    const familyPayment =
      paymentResult.status === "fulfilled" ? paymentResult.value : null;
    const scholarshipRow =
      scholarshipResult.status === "fulfilled"
        ? scholarshipResult.value
        : null;
    const familyRow =
      familyRowResult.status === "fulfilled" ? familyRowResult.value : null;

    // Note: the old backfill shim that mirrored `monthly_tuition_payment`
    // and `monthly_transportation_payment` from `registration_families_payment`
    // onto `registration_student_registration_progress` is gone. Both
    // columns moved per-student onto `registration_student_registration`
    // (the packet rows return as part of `students[].packet` below),
    // and downstream surfaces derive family totals via
    // `sumFamilyBillingTotals(packets)`.

    if (!agg) {
      return NextResponse.json(
        { error: "Family not found for this year" },
        { status: 404 }
      );
    }

    const family: XanoFamily | null = agg.family
      ? // Aggregate omits the emergency-contacts back-reference; cast
        // through unknown since we don't read that field here.
        ((agg.family as unknown) as XanoFamily)
      : null;
    const schoolYear = agg.school_year;
    const apps: XanoApplication[] = Array.isArray(agg.application)
      ? agg.application
      : [];

    const activeApps = apps.filter((a) => a.isActive !== false);
    const activeStudentIds = new Set(
      activeApps.map((a) => Number(a.registration_students_id))
    );

    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const packetByStudentId = new Map<number, XanoStudentRegistration>();
    for (const p of allPackets) {
      const sid = Number(p.registration_students_id);
      if (activeStudentIds.has(sid)) {
        packetByStudentId.set(sid, p);
      }
    }

    const parentIds = family ? xano.families.getParentIds(family) : [];
    const familyParents = parents.filter((p) => parentIds.includes(p.id));
    const sortedParents = familyParents
      .slice()
      .sort((a, b) => a.id - b.id);
    const primary: XanoParent | null = sortedParents[0] ?? null;
    // Second parent on file (by id order) — surfaced so the admin
    // "Email parent" button can Cc them alongside the primary.
    const secondary: XanoParent | null = sortedParents[1] ?? null;

    // Per-student packet rows — the entire `XanoStudentRegistration`
    // shape, plus the joined student bio fields the page uses for the
    // section header (name, DOB, grade). Returning the full packet
    // lets the client render every parent-facing field as a
    // disabled-input summary the same way the application page does.
    const studentRows: AdminFamilyRegistrationStudentRow[] = activeApps.map(
      (app) => {
        const studentId = Number(app.registration_students_id);
        const student: XanoStudent | null = studentById.get(studentId) ?? null;
        const packet: XanoStudentRegistration | null =
          packetByStudentId.get(studentId) ?? null;
        return {
          application_id: app.id,
          student_id: studentId,
          student_first_name: student?.first_name ?? "",
          student_last_name: student?.last_name ?? "",
          student_full_name: student
            ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
            : `Student #${studentId}`,
          student_date_of_birth: student?.date_of_birth ?? "",
          student_grade: app.current_grade ?? "",
          // Parent-entered "Current / previous school" from the
          // application — surfaced so the Request-records dialog can
          // pre-fill the recipient school (matches the enrolled page).
          student_previous_school: app.current_previous_school ?? "",
          packet,
          // Evergreen document uploads live on the *student* row as
          // arrays of file blobs (not on the per-year packet — those
          // columns are legacy / empty). Parents can upload multiple
          // files per category, so the row carries the raw arrays;
          // the per-student card renders one row per file.
          //
          // Per-file confirm fields (`confirmed`, `confirmed_at`,
          // `confirmed_admin`) get hydrated from the slot-level audit
          // bool on first read when individual files don't have them
          // yet — that way legacy rows that were "slot confirmed"
          // before per-file confirm shipped don't visually regress to
          // unconfirmed. New writes go per-file via the
          // `/document-file` route, which also recomputes the slot
          // bool so downstream gates stay in sync.
          student_documents: {
            birth_certificate: hydrateFileConfirms(
              student?.birth_certificate,
              {
                slotConfirmed:
                  student?.birth_certificate_admin_confirm === true,
                slotConfirmedAt:
                  student?.birth_certificate_admin_confirm_time ?? null,
                slotConfirmedAdmin:
                  student?.birth_certificate_admin_confirm_admin ?? "",
              }
            ),
            school_health_form: hydrateFileConfirms(
              student?.school_health_form,
              {
                slotConfirmed:
                  student?.school_health_form_admin_confirm === true,
                slotConfirmedAt:
                  student?.school_health_form_admin_confirm_time ?? null,
                slotConfirmedAdmin:
                  student?.school_health_form_admin_confirm_admin ?? "",
              }
            ),
            transcripts: hydrateFileConfirms(student?.transcripts, {
              slotConfirmed: student?.transcripts_admin_confirm === true,
              slotConfirmedAt:
                student?.transcripts_admin_confirm_time ?? null,
              slotConfirmedAdmin:
                student?.transcripts_admin_confirm_admin ?? "",
            }),
            iep: normalizeFileArray(student?.iep),
            ssn_card: normalizeFileArray(student?.ssn_card),
            immunization_forms: hydrateFileConfirms(
              student?.immunization_forms,
              {
                slotConfirmed:
                  student?.immunization_admin_confirm === true,
                slotConfirmedAt:
                  student?.immunization_admin_confirm_time ?? null,
                slotConfirmedAdmin:
                  student?.immunization_admin_confirm_admin ?? "",
              }
            ),
            passport: normalizeFileArray(student?.passport),
            student_state_id: normalizeFileArray(student?.student_state_id),
            discipline: normalizeFileArray(student?.discipline),
          },
          // Per-document admin-confirm state. Live on the student
          // row (added against the `2GcBXyoA` admin group). Optional
          // on `XanoStudent` — legacy rows return `undefined` for
          // these fields, which the UI reads as "not yet confirmed."
          document_confirms: {
            birth_certificate: {
              confirmed: student?.birth_certificate_admin_confirm === true,
              confirmed_time:
                student?.birth_certificate_admin_confirm_time ?? null,
              confirmed_admin:
                student?.birth_certificate_admin_confirm_admin ?? "",
            },
            school_health_form: {
              confirmed:
                student?.school_health_form_admin_confirm === true,
              confirmed_time:
                student?.school_health_form_admin_confirm_time ?? null,
              confirmed_admin:
                student?.school_health_form_admin_confirm_admin ?? "",
            },
            transcripts: {
              confirmed: student?.transcripts_admin_confirm === true,
              confirmed_time:
                student?.transcripts_admin_confirm_time ?? null,
              confirmed_admin:
                student?.transcripts_admin_confirm_admin ?? "",
            },
            immunization_forms: {
              confirmed: student?.immunization_admin_confirm === true,
              confirmed_time:
                student?.immunization_admin_confirm_time ?? null,
              confirmed_admin:
                student?.immunization_admin_confirm_admin ?? "",
            },
          },
          // Admin verification triplet — lives on the per-packet
          // `registration_student_registration` row (each year a
          // student re-enrolls gets its own packet, with its own
          // verify state). Surfaced here so the per-student card
          // can render the "Verify {Name} Registration" footer +
          // audit caption without an extra fetch.
          is_verified: packet?.registrationConfirmed === true,
          is_admin_verified_time:
            packet?.registration_confirmed_admin_time ?? null,
          is_admin_verified_admin:
            packet?.is_registration_admin_confirm_admin ?? "",
          // Per-application fields driving the Tuition card's
          // per-student breakdown table. Same data the parent's
          // `/dashboard/tuition` reads — the family-side and admin-
          // side surfaces compute the same numbers from the same
          // source so admin sees exactly what the parent signed.
          sufs_status: app.sufs_status ?? "",
          sufs_type: app.sufs_type ?? "",
          opportunity_scholarship_award_amount:
            app.opportunity_scholarship_award_amount ?? null,
          is_bus_transportation: !!app.is_bus_transportation,
          bus_stop: app.bus_stop ?? "",
          // Per-student billing math (source of truth: the
          // application row). Surfaced here so the page's family
          // billing totals can sum them without an extra fetch.
          tuition_total: app.tuition_total ?? null,
          sufs_amount: app.sufs_amount ?? null,
          opportunity_award_amount: app.opportunity_award_amount ?? null,
          annual_fee: app.annual_fee ?? null,
          tuition_sub_total: app.tuition_sub_total ?? null,
          monthly_amount: app.monthly_amount ?? null,
          remaining_opportunity_amount:
            app.remaining_opportunity_amount ?? null,
          // Per-student scholarship-confirmation latch. Flipped by
          // admin's "Confirm Scholarship Award Amount" button on the
          // family page Determination card; gates whether the
          // Opportunity Scholarship Award dollar value renders on
          // the tuition breakdown.
          confirmed_scholarship: app.confirmed_scholarship === true,
        };
      }
    );

    return NextResponse.json({
      family: family
        ? {
            id: family.id,
            family_name: family.family_name ?? "",
            is_residential: familyRow?.is_residential ?? false,
          }
        : null,
      primary: primary
        ? {
            id: primary.id,
            first_name: primary.first_name ?? "",
            last_name: primary.last_name ?? "",
            email: primary.email ?? "",
            phone: primary.phone ?? "",
          }
        : null,
      secondary: secondary
        ? {
            id: secondary.id,
            first_name: secondary.first_name ?? "",
            last_name: secondary.last_name ?? "",
            email: secondary.email ?? "",
            phone: secondary.phone ?? "",
          }
        : null,
      school_year: {
        id: schoolYear.id,
        year_name: schoolYear.year_name ?? "",
        tuition: schoolYear.tuition ?? 0,
        annual_fees: schoolYear.annual_fees ?? 0,
        transportation_fees: schoolYear.transportation_fees ?? 0,
        // First-invoice anchor. Surfaced on the admin Billing card
        // empty state so admin sees when invoicing will begin
        // before clicking Start Monthly Billing. Null when admin
        // hasn't set the date on the school year yet.
        billing_start_date: schoolYear.billing_start_date ?? null,
        // Per-SUFS-tier award amounts. The Tuition card's per-student
        // breakdown reads these to compute the green "Step Up Award
        // Amount" line — same math the parent dashboard's
        // /dashboard/tuition page runs. Falls back to 0 for any tier
        // not configured on this year.
        fes_eo_8: schoolYear.fes_eo_8 ?? 0,
        fes_eo_9: schoolYear.fes_eo_9 ?? 0,
        ftc_8: schoolYear.ftc_8 ?? 0,
        ftc_9: schoolYear.ftc_9 ?? 0,
        fes_ua_8_ese_1_3: schoolYear.fes_ua_8_ese_1_3 ?? 0,
        fes_ua_9_ese_1_3: schoolYear.fes_ua_9_ese_1_3 ?? 0,
        fes_ua_ese_4: schoolYear.fes_ua_ese_4 ?? 0,
        fes_ua_ese_5: schoolYear.fes_ua_ese_5 ?? 0,
      },
      progress: progress as XanoStudentRegistrationProgress | null,
      students: studentRows,
      emergency_contacts: emergencyContacts as XanoEmergencyContact[],
      // Family-level scholarship summary — only the bits the
      // registration detail page actually needs. The full
      // scholarship row isn't surfaced (Financial Aid lives on
      // the apply-flow detail page); registration just needs to
      // know which path the family's on so the Tuition card's
      // per-student breakdown table can compute the
      // Opportunity Scholarship coverage the SNAP way (covers
      // tuition + transport - SUFS) instead of reading the
      // per-app `opportunity_scholarship_award_amount` column
      // — that's null on purpose for SNAP families and the
      // table was rendering "—" instead of the actual coverage.
      scholarship: {
        isOpportunityScholarship:
          scholarshipRow?.isOpportunityScholarship === true,
        isSNAPBenefits: scholarshipRow?.isSNAPBenefits === true,
        isNotParticipating:
          scholarshipRow?.isNotParticipating === true,
        is_snap_confirmed:
          scholarshipRow?.is_snap_confirmed === true,
      },
    } satisfies AdminFamilyRegistrationResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Response shape the family registration detail page consumes. Carries
 * the full per-student packet object so the page can render every
 * parent-facing field as a disabled summary input, plus the family-
 * scoped emergency contacts roster.
 */
export interface AdminFamilyRegistrationResponse {
  family: { id: number; family_name: string; is_residential: boolean } | null;
  primary: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  } | null;
  secondary: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  } | null;
  school_year: {
    id: number;
    year_name: string;
    tuition: number;
    annual_fees: number;
    transportation_fees: number;
    /** YYYY-MM-DD or null. Drives the Billing card's "Invoicing
     *  starts on …" microcopy + the trial_end anchor when admin
     *  starts a Stripe subscription for the family. */
    billing_start_date: string | null;
    fes_eo_8: number;
    fes_eo_9: number;
    ftc_8: number;
    ftc_9: number;
    fes_ua_8_ese_1_3: number;
    fes_ua_9_ese_1_3: number;
    fes_ua_ese_4: number;
    fes_ua_ese_5: number;
  };
  progress: XanoStudentRegistrationProgress | null;
  students: AdminFamilyRegistrationStudentRow[];
  emergency_contacts: XanoEmergencyContact[];
  /** Family-level scholarship summary — minimal projection of the
   *  scholarship row. Tells the Tuition card's per-student
   *  breakdown table which path the family's on (so SNAP-confirmed
   *  rows show the computed Opportunity Scholarship coverage
   *  instead of a literal `—`). `is_snap_confirmed === true`
   *  signals the SNAP path is fully verified, which is when the
   *  computed coverage kicks in. */
  scholarship: {
    isOpportunityScholarship: boolean;
    isSNAPBenefits: boolean;
    isNotParticipating: boolean;
    is_snap_confirmed: boolean;
  };
}

export interface AdminFamilyRegistrationStudentRow {
  application_id: number;
  student_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_date_of_birth: string;
  student_grade: string;
  /** Parent-entered "Current / previous school" from the application.
   *  Pre-fills the Request-records dialog; empty for residential /
   *  re-application rows that seed it blank. */
  student_previous_school: string;
  /** Full packet object; null when the parent hasn't started one yet. */
  packet: XanoStudentRegistration | null;
  /** Evergreen document arrays from the student row (not the packet).
   *  One file blob per upload — parents can upload multiple per
   *  category. Each entry carries Xano's `{ name, path, url?, mime,
   *  size }` shape. */
  student_documents: {
    birth_certificate: Record<string, unknown>[];
    school_health_form: Record<string, unknown>[];
    transcripts: Record<string, unknown>[];
    iep: Record<string, unknown>[];
    ssn_card: Record<string, unknown>[];
    immunization_forms: Record<string, unknown>[];
    passport: Record<string, unknown>[];
    student_state_id: Record<string, unknown>[];
    discipline: Record<string, unknown>[];
  };
  /** Per-document admin-confirm state for the four required
   *  documents. The bool is what the UI reads/writes; time + admin
   *  name are auto-stamped server-side. Audit triplets live on the
   *  student row in Xano (added against the `2GcBXyoA` admin
   *  group). All three optional because legacy rows pre-date the
   *  column add. */
  document_confirms: {
    birth_certificate: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    school_health_form: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    transcripts: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    immunization_forms: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
  };
  /** Admin verification triplet pulled from the student row. */
  is_verified: boolean;
  is_admin_verified_time: number | null;
  is_admin_verified_admin: string;
  /** Per-application Step Up status / type / scholarship amount and
   *  transportation election. Same fields the parent-facing tuition
   *  table reads from the application row — surfaced here so the
   *  Tuition card on the registration detail page can render the
   *  identical breakdown without admin needing to cross-reference
   *  the apply-flow view. */
  sufs_status: string;
  sufs_type: string;
  opportunity_scholarship_award_amount: number | null;
  is_bus_transportation: boolean;
  bus_stop: string;
  /** Per-student billing math from the application row (source of
   *  truth). Driven by admin's inputs on the Scholarship
   *  Determination card; the page sums these into the family
   *  monthly total via `sumFamilyBillingTotals`. */
  tuition_total: number | null;
  sufs_amount: number | null;
  opportunity_award_amount: number | null;
  annual_fee: number | null;
  tuition_sub_total: number | null;
  monthly_amount: number | null;
  remaining_opportunity_amount: number | null;
  /** True when admin has clicked Confirm Scholarship Award Amount
   *  on the Determination card for this student. Used by the
   *  tuition breakdown to gate whether the Opportunity Scholarship
   *  Award dollar value renders or shows as "—" pending. */
  confirmed_scholarship: boolean;
}

/**
 * Coerce Xano's file column into an array of file blobs. Xano has
 * historically returned `[]`, `null`, or `{}` for empty file
 * columns — the live schema settled on `[]`, but we tolerate the
 * older shapes so a partial migration doesn't crash the page.
 * Mirrors the helper in `/api/admin/enrolled/[id]`.
 */
function normalizeFileArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null
    );
  }
  return [];
}

/**
 * Normalize a file array AND hydrate each file's per-file confirm
 * fields from the slot-level audit bool when the file blob doesn't
 * carry them yet. Used for the four required-doc slots
 * (birth_certificate, school_health_form, transcripts,
 * immunization_forms) where per-file confirmation replaced the
 * single per-slot bool. Legacy rows where admin already confirmed
 * the slot survive the migration — every file in such a slot reads
 * back as `confirmed: true` until admin explicitly toggles a
 * particular file off.
 */
function hydrateFileConfirms(
  raw: unknown,
  slot: {
    slotConfirmed: boolean;
    slotConfirmedAt: number | null;
    slotConfirmedAdmin: string;
  }
): Record<string, unknown>[] {
  const files = normalizeFileArray(raw);
  return files.map((file) => {
    if (Object.prototype.hasOwnProperty.call(file, "confirmed")) {
      // File already carries an explicit per-file confirm — trust
      // it as-is. Skipping the inherit here is what lets admin toggle
      // a previously slot-confirmed file back to unconfirmed.
      return file;
    }
    return {
      ...file,
      confirmed: slot.slotConfirmed,
      confirmed_at: slot.slotConfirmed ? slot.slotConfirmedAt : null,
      confirmed_admin: slot.slotConfirmed ? slot.slotConfirmedAdmin : "",
    };
  });
}
