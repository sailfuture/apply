import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_COLUMN,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
} from "@/lib/xano";
import { bumpLeadReachOut } from "@/lib/leads";

/**
 * Admin notes (the comms log). Two kinds of scope share the table:
 *
 *  - `?familyId=X` — notes about a family, used on the family detail
 *    page's pinned bottom-right Notes drawer.
 *  - `?leadSource=inquiry|camp|visit|tasco&leadId=X` — notes about a
 *    recruitment lead, used by the per-source recruitment pages and
 *    All Leads. `?inquiryId=X` is the legacy spelling of
 *    `leadSource=inquiry`.
 *
 * Exactly one scope must be supplied. Lead scopes filter on their own
 * FK column so timelines never bleed into each other or into family
 * comms.
 *
 * Notes can optionally narrow to a specific student or year via the
 * `registration_students_id` / `registration_school_years_id` columns;
 * filtering by those is done client-side since we always read the full
 * per-scope list anyway.
 */

/** Resolve the lead scope from either spelling; null when absent,
 *  `"invalid"` when present but malformed. */
function parseLeadScope(
  params: URLSearchParams
): { source: LeadNoteSource; id: number } | null | "invalid" {
  const legacyInquiry = params.get("inquiryId");
  const sourceParam = params.get("leadSource");
  const idParam = params.get("leadId");
  if (legacyInquiry) {
    const id = Number(legacyInquiry);
    return Number.isFinite(id) && id > 0
      ? { source: "inquiry", id }
      : "invalid";
  }
  if (!sourceParam && !idParam) return null;
  const id = Number(idParam);
  if (
    !LEAD_NOTE_SOURCES.includes(sourceParam as LeadNoteSource) ||
    !Number.isFinite(id) ||
    id <= 0
  ) {
    return "invalid";
  }
  return { source: sourceParam as LeadNoteSource, id };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const lead = parseLeadScope(req.nextUrl.searchParams);

    if (lead === "invalid") {
      return NextResponse.json(
        {
          error:
            "leadSource must be inquiry|camp|visit|tasco and leadId a positive number",
        },
        { status: 400 }
      );
    }
    if (!familyIdParam && !lead) {
      return NextResponse.json(
        { error: "familyId or leadSource+leadId is required" },
        { status: 400 }
      );
    }
    if (familyIdParam && lead) {
      return NextResponse.json(
        { error: "Provide only one of familyId or leadSource+leadId" },
        { status: 400 }
      );
    }

    // Optional `?section=…` filter — narrows a family's notes to a
    // specific surface (e.g. one contributing member's review).
    // Applied client-side after the per-scope fetch since Xano's
    // auto-generated GET doesn't honor arbitrary text filters.
    const sectionParam = req.nextUrl.searchParams.get("section");

    // Optional `?phase=registration&yearId=Y` — calls the dedicated
    // Xano query that returns only notes tagged for the registration
    // phase of this (family, year). Used by the family registration
    // detail page so admin doesn't see apply-phase comms mixed in.
    // The apply phase still goes through the catch-all `getByFamilyId`
    // and relies on client-side filter pills. Re-enrollment notes now
    // land on the same `registration_family_application_progress_id`
    // FK as new-applicant notes since the apply flow is unified across
    // both, so there's no separate reapply phase here.
    const phaseParam = req.nextUrl.searchParams.get("phase");
    const yearIdParam = req.nextUrl.searchParams.get("yearId");

    if (lead) {
      const notes = await xano.adminNotes.getByLead(lead.source, lead.id);
      return NextResponse.json(
        sectionParam ? notes.filter((n) => n.section === sectionParam) : notes
      );
    }

    const familyId = Number(familyIdParam);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json(
        { error: "familyId must be a number" },
        { status: 400 }
      );
    }

    if (phaseParam === "registration") {
      const yearId = Number(yearIdParam);
      if (!Number.isFinite(yearId) || yearId <= 0) {
        return NextResponse.json(
          { error: "yearId is required when phase=registration" },
          { status: 400 }
        );
      }
      const notes =
        await xano.adminNotes.getByFamilyAndYearForRegistration(
          familyId,
          yearId
        );
      return NextResponse.json(
        sectionParam ? notes.filter((n) => n.section === sectionParam) : notes
      );
    }

    let notes = await xano.adminNotes.getByFamilyId(familyId);

    // `phase=application` is the inverse of `phase=registration`:
    // strip out any note that's tagged for the registration phase
    // (`registration_student_registration_progress_id` set), so the
    // family detail (apply-flow) drawers don't leak registration
    // comms into the application timeline. Apply-phase notes (both
    // new applicants and re-enrollers — same FK now) plus general
    // communication notes pass through. Legacy notes stamped against
    // the deprecated `reapply_family_progress_id` column also pass
    // through; the client-side filter rolls them into the Apply pill.
    if (phaseParam === "application") {
      notes = notes.filter((n) => {
        const id = n.registration_student_registration_progress_id;
        return id == null || id === 0;
      });
    }

    return NextResponse.json(
      sectionParam ? notes.filter((n) => n.section === sectionParam) : notes
    );
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

    const familyId = optionalNumber(body?.registration_families_id);
    // Lead scope: `leadSource` + `leadId`, or the legacy
    // `registration_inquiry_id` spelling.
    const legacyInquiryId = optionalNumber(body?.registration_inquiry_id);
    const rawLeadSource = body?.leadSource;
    const leadIdFromBody = optionalNumber(body?.leadId);
    let lead: { source: LeadNoteSource; id: number } | null = null;
    if (legacyInquiryId) {
      lead = { source: "inquiry", id: legacyInquiryId };
    } else if (rawLeadSource != null || leadIdFromBody != null) {
      if (
        !LEAD_NOTE_SOURCES.includes(rawLeadSource as LeadNoteSource) ||
        !leadIdFromBody
      ) {
        return NextResponse.json(
          {
            error:
              "leadSource must be inquiry|camp|visit|tasco and leadId a positive number",
          },
          { status: 400 }
        );
      }
      lead = { source: rawLeadSource as LeadNoteSource, id: leadIdFromBody };
    }

    // Exactly-one rule mirrors the GET — keeps a single note from
    // appearing in two timelines and simplifies cache invalidation.
    if (!familyId && !lead) {
      return NextResponse.json(
        {
          error:
            "registration_families_id or leadSource+leadId is required",
        },
        { status: 400 }
      );
    }
    if (familyId && lead) {
      return NextResponse.json(
        {
          error:
            "Provide only one of registration_families_id / leadSource+leadId",
        },
        { status: 400 }
      );
    }

    const trimmedBody = typeof body?.body === "string" ? body.body.trim() : "";
    if (!trimmedBody) {
      return NextResponse.json(
        { error: "Note body is required" },
        { status: 400 }
      );
    }

    // Phase tagging — the caller passes `phase=...` along with
    // `registration_school_years_id`, and we stamp the matching
    // progress-row FK on the note so the dedicated per-phase Xano
    // queries surface it back. Each phase has its own column on
    // `registration_admin_notes`:
    //
    //   - application  → `registration_family_application_progress_id`
    //                    (resolves the per-year apply-flow progress row;
    //                     both new applicants and re-enrollers share
    //                     this FK now that the flows are unified — the
    //                     `type` field on the progress row distinguishes
    //                     them when admin needs to)
    //   - registration → `registration_student_registration_progress_id`
    //                    (resolves the per-year registration packet
    //                     progress row)
    //
    // The legacy `reapply_family_progress_id` column on
    // `registration_admin_notes` is no longer written to — any note we
    // create for a re-enroller flows through the application branch
    // above. Legacy rows with that FK set still display via the
    // client-side phase pill.
    //
    // Each `resolve()` is race-safe (in-process mutex + post-create
    // dedupe). If the resolve fails we log and fall through with a
    // null FK rather than failing the note write — admin still sees
    // their note saved on the family timeline, and the next visit
    // to that surface will retry the resolve.
    const phaseParam =
      typeof body?.phase === "string" ? body.phase : null;
    const yearForPhase = optionalNumber(
      body?.registration_school_years_id
    );
    let registrationProgressId: number | null = optionalNumber(
      body?.registration_student_registration_progress_id
    );
    let applicationProgressId: number | null = optionalNumber(
      body?.registration_family_application_progress_id
    );
    if (
      phaseParam === "registration" &&
      familyId &&
      yearForPhase &&
      !registrationProgressId
    ) {
      try {
        const progressRow =
          await xano.studentRegistrationProgress.resolve(
            familyId,
            yearForPhase
          );
        registrationProgressId = progressRow?.id ?? null;
      } catch (err) {
        console.error(
          "[/api/admin/notes POST] failed to resolve registration progress row:",
          err
        );
      }
    }
    if (
      phaseParam === "application" &&
      familyId &&
      yearForPhase &&
      !applicationProgressId
    ) {
      try {
        const progressRow =
          await xano.familyApplicationProgress.resolve(
            familyId,
            yearForPhase
          );
        applicationProgressId = progressRow?.id ?? null;
      } catch (err) {
        console.error(
          "[/api/admin/notes POST] failed to resolve application progress row:",
          err
        );
      }
    }

    // For family notes, `registration_families_id` is the required FK
    // on Xano. For lead-scoped notes we still send a families id
    // (Xano column is non-nullable on legacy rows) — set to 0 so
    // it's an explicit "no family" rather than dragging in a real one.
    // Exactly one lead FK is set; the other three stay null.
    const note = await xano.adminNotes.create({
      registration_families_id: familyId ?? 0,
      registration_students_id: optionalNumber(body?.registration_students_id),
      registration_school_years_id: yearForPhase,
      registration_inquiry_id:
        lead?.source === "inquiry" ? lead.id : null,
      registration_summer_camp_id:
        lead?.source === "camp" ? lead.id : null,
      website_liability_waiver_id:
        lead?.source === "visit" ? lead.id : null,
      tasco_summer_visit_id: lead?.source === "tasco" ? lead.id : null,
      registration_student_registration_progress_id: registrationProgressId,
      registration_family_application_progress_id: applicationProgressId,
      author_email: admin.email,
      author_name: admin.name,
      body: trimmedBody,
      category: typeof body?.category === "string" ? body.category : "other",
      is_pinned: body?.is_pinned === true,
      section:
        typeof body?.section === "string" && body.section.trim().length > 0
          ? body.section.trim()
          : null,
      // Default-internal: a note is admin-only unless the caller
      // explicitly asks to share it. Avoids accidental disclosure
      // when a future surface forgets to set the field.
      is_shared_with_parent: body?.is_shared_with_parent === true,
    });

    // Guard against an unwired Xano column. Xano silently DROPS
    // inputs its Add Record endpoint doesn't declare, so a missing
    // lead FK column (or a column that exists but isn't exposed as an
    // input) would save the note with no scope at all — it would
    // vanish from every timeline while still reporting success. Verify
    // the FK came back set; if it didn't, remove the orphan and tell
    // the caller exactly what to wire, rather than leaving a note the
    // admin thinks they saved.
    if (lead) {
      const column = LEAD_NOTE_COLUMN[lead.source];
      if (Number(note?.[column]) !== lead.id) {
        await xano.adminNotes.delete(note.id).catch((err) => {
          console.error(
            "[/api/admin/notes POST] failed to clean up unscoped note:",
            err
          );
        });
        return NextResponse.json(
          {
            error:
              `Notes aren't wired for this lead type yet: add the nullable ` +
              `\`${column}\` column to registration_admin_notes in Xano and ` +
              `expose it as an input on the Add Record endpoint.`,
          },
          { status: 501 }
        );
      }
    }

    // Bump the lead's `last_reach_out` so the recruitment lists can
    // show "last contacted X days ago" without scanning the notes
    // timeline on every render. Server-managed: each lead table's
    // PATCH allowlist intentionally excludes this field so admins
    // can't edit it by hand. Best-effort — `bumpLeadReachOut` logs
    // and swallows so a failed stamp never loses the saved note.
    if (lead) {
      await bumpLeadReachOut(lead.source, lead.id);
    }

    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
