import "server-only";

import {
  xano,
  tourLeadFk,
  type LeadNoteSource,
  type XanoTour,
} from "@/lib/xano";
import { tourNoteBody } from "@/lib/tours";

/**
 * Write one tour lifecycle event into a lead's comms log — the single
 * path every tour route uses, so scheduling, syncing, and the
 * lifecycle actions can't drift on note shape or error handling.
 *
 * The echo guard is the point of this module. Xano silently DROPS
 * inputs its Add Record endpoint doesn't declare, so a note for a
 * lead type whose FK column isn't wired saves with NO scope at all:
 * it vanishes from every timeline while the write reports success.
 * That is exactly how tour notes for camp / visit / TASCO leads went
 * missing. Here we verify the FK came back set and delete the orphan
 * if it didn't, returning the reason so the caller can surface a
 * warning instead of quietly losing the record.
 *
 * Never throws — the tour state change has already landed, and a
 * failed note must not turn a successful action into an error.
 */
export async function writeTourNote({
  lead,
  tour,
  event,
  admin,
  notified = true,
}: {
  lead: { source: LeadNoteSource; id: number };
  tour: XanoTour;
  event: Parameters<typeof tourNoteBody>[0];
  admin: { email: string; name: string };
  /** Did the parent actually get an email for this change? Only the
   *  wordings that mention notification consult it. */
  notified?: boolean;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  const column = leadColumn(lead.source);
  try {
    const note = await xano.adminNotes.create({
      registration_families_id: 0,
      registration_students_id: null,
      registration_school_years_id: null,
      // Same four FK column names the tour row itself uses.
      ...tourLeadFk(lead),
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: admin.email,
      author_name: admin.name,
      body: tourNoteBody(event, tour, notified),
      category: "tour",
      is_pinned: false,
      section: null,
      is_shared_with_parent: false,
    });

    if (Number(note?.[column]) !== lead.id) {
      await xano.adminNotes.delete(note.id).catch((err) => {
        console.error("[writeTourNote] failed to remove orphan note:", err);
      });
      return {
        ok: false,
        warning:
          `The tour was updated, but it couldn't be logged to this lead's ` +
          `timeline: add the \`${column}\` column to registration_admin_notes ` +
          `in Xano and expose it as an input on the Add Record endpoint.`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[writeTourNote] note write failed:", err);
    return {
      ok: false,
      warning:
        "The tour was updated, but writing it to the lead's timeline failed.",
    };
  }
}

function leadColumn(
  source: LeadNoteSource
):
  | "registration_inquiry_id"
  | "registration_summer_camp_id"
  | "website_liability_waiver_id"
  | "tasco_summer_visit_id" {
  return source === "inquiry"
    ? "registration_inquiry_id"
    : source === "camp"
      ? "registration_summer_camp_id"
      : source === "visit"
        ? "website_liability_waiver_id"
        : "tasco_summer_visit_id";
}
