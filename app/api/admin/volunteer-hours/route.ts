import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
  XanoVolunteerHours,
} from "@/lib/xano";
import { computeFamilyStageSets } from "@/lib/sms/stages";

/** One family row for the volunteer-hours page — every family the
 *  admin could credit, flagged with whether they're enrolled for the
 *  year (the 40-hour tracker lists enrolled families). */
export interface VolunteerFamily {
  id: number;
  name: string;
  enrolled: boolean;
  /** The family's students for the year, FULL names dot-joined
   *  ("Jorden Smith · Mia Smith") — shown in the family pickers and
   *  matched by their search boxes, so searching a student's first
   *  OR last name finds the family. */
  students: string;
}

/** Calendar event joined with its day's date (events pin to a
 *  `school_calendar` day row, which owns the date). */
export type VolunteerEvent = XanoSchoolCalendarEvent & { date: string };

/** One family's RSVP, family name joined for display. */
export interface EventRsvpRow {
  id: number;
  school_calendar_events_id: number;
  registration_families_id: number;
  family_name: string;
  spots: number;
  comment: string;
}

export interface AdminVolunteerHoursResponse {
  entries: XanoVolunteerHours[];
  families: VolunteerFamily[];
  events: VolunteerEvent[];
  /** Parent RSVPs across all events (page groups by event). Empty
   *  when the `school_event_rsvps` table doesn't exist yet. */
  rsvps: EventRsvpRow[];
  /** The year's day rows — the shared event dialog needs them to
   *  resolve a picked date to its `school_calendar_id`. */
  days: XanoSchoolCalendarDay[];
}

/**
 * Admin volunteer-hours workspace data + bulk entry creation.
 *
 *   GET ?yearId=Y → { entries, families, events } — the year's hour
 *     entries, every family (enrolled-flagged via the shared stage
 *     bucketing), and the year's calendar events with dates so the
 *     page can join entries → events and offer event linking.
 *
 *   POST { yearId, familyIds: number[], hours, entryDate,
 *          eventId?, approved? } — one entry per family (how event
 *     attendees are credited in bulk, and how single manual entries
 *     are added). Admin-created entries default to approved, stamped
 *     with the admin's name + time.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [
      entriesR,
      familiesR,
      daysR,
      eventsR,
      fapR,
      srpR,
      appsR,
      studentsR,
      rsvpsR,
    ] = await Promise.allSettled([
      xano.volunteerHours.getAll(),
      xano.families.getAll(),
      xano.schoolCalendar.getByYear(yearId),
      xano.schoolCalendarEvents.getAll(),
      xano.familyApplicationProgress.getByYear(yearId),
      xano.studentRegistrationProgress.getByYear(yearId),
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.eventRsvps.getAll(),
    ]);
    const val = <T,>(r: PromiseSettledResult<T[]>): T[] =>
      r.status === "fulfilled" ? r.value : [];
    for (const [label, r] of [
      ["entries", entriesR],
      ["families", familiesR],
      ["days", daysR],
      ["events", eventsR],
    ] as const) {
      if (r.status === "rejected") {
        console.error(
          `[/api/admin/volunteer-hours] failed to load ${label}:`,
          r.reason
        );
      }
    }

    const entries = val(entriesR).filter(
      (e) => Number(e.registration_school_years_id) === yearId
    );
    entries.sort((a, b) =>
      (a.entry_date ?? "").localeCompare(b.entry_date ?? "")
    );

    const stageSets = computeFamilyStageSets({
      fap: val(fapR),
      srp: val(srpR),
    });

    // Per-family student FULL names for the year — same application
    // join the group-audience route uses (year-scoped, inactive apps
    // skipped, deduped per student). Full names (not just first) so
    // the pickers' search matches a student's last name too.
    const studentName = new Map(
      val(studentsR).map((s) => [
        s.id,
        `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
      ])
    );
    const familyStudents = new Map<number, string[]>();
    for (const a of val(appsR)) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const fid = Number(a.registration_families_id);
      const sid = Number(a.registration_students_id);
      if (!fid || !sid) continue;
      const name = studentName.get(sid) || "";
      if (!name) continue;
      const list = familyStudents.get(fid) ?? [];
      if (!list.includes(name)) list.push(name);
      familyStudents.set(fid, list);
    }

    const families: VolunteerFamily[] = val(familiesR)
      .map((f) => ({
        id: f.id,
        name: f.family_name?.trim() || `Family #${f.id}`,
        enrolled: stageSets.enrolled.has(f.id),
        students: (familyStudents.get(f.id) ?? []).join(" · "),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const days = val(daysR);
    const dateByDay = new Map(days.map((d) => [d.id, d.date]));
    const events: VolunteerEvent[] = val(eventsR)
      .filter((e) => dateByDay.has(Number(e.school_calendar_id)))
      .map((e) => ({
        ...e,
        date: dateByDay.get(Number(e.school_calendar_id)) ?? "",
      }))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.start_time ?? 0) - (b.start_time ?? 0)
      );

    // RSVPs joined with family names for the per-event sign-up list.
    // Degrades to [] while the rsvps table doesn't exist yet.
    const familyNameById = new Map(
      val(familiesR).map((f) => [f.id, f.family_name?.trim() || `Family #${f.id}`])
    );
    const rsvps: EventRsvpRow[] = val(rsvpsR).map((r) => ({
      id: r.id,
      school_calendar_events_id: Number(r.school_calendar_events_id),
      registration_families_id: Number(r.registration_families_id),
      family_name:
        familyNameById.get(Number(r.registration_families_id)) ??
        `Family #${r.registration_families_id}`,
      spots: Number(r.spots) || 0,
      comment: (r.comment ?? "").trim(),
    }));

    days.sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({
      entries,
      families,
      events,
      rsvps,
      days,
    } satisfies AdminVolunteerHoursResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const rawIds: unknown[] = Array.isArray(body.familyIds)
      ? body.familyIds
      : [];
    const familyIds = [
      ...new Set(
        rawIds
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    if (familyIds.length === 0) {
      return NextResponse.json(
        { error: "familyIds is required" },
        { status: 400 }
      );
    }
    if (familyIds.length > 200) {
      return NextResponse.json(
        { error: "Too many families in one request (max 200)" },
        { status: 400 }
      );
    }
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 100) {
      return NextResponse.json(
        { error: "hours must be between 0 and 100" },
        { status: 400 }
      );
    }
    const entryDate =
      typeof body.entryDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate)
        ? body.entryDate
        : null;
    if (!entryDate) {
      return NextResponse.json(
        { error: "entryDate (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    const eventIdRaw = Number(body.eventId);
    const eventId =
      Number.isFinite(eventIdRaw) && eventIdRaw > 0 ? eventIdRaw : 0;
    const approved = body.approved !== false; // admin adds default approved
    // Optional free-text note ("rising junior meeting w/ Mr. Angelo").
    // Requires the `note` column on the Xano table — absent, Xano
    // drops the input and entries save without it.
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    const now = Date.now();
    const created: XanoVolunteerHours[] = [];
    for (let i = 0; i < familyIds.length; i += 10) {
      const chunk = await Promise.all(
        familyIds.slice(i, i + 10).map((familyId) =>
          xano.volunteerHours.create({
            registration_families_id: familyId,
            registration_school_years_id: yearId,
            entry_date: entryDate,
            hours,
            is_approved: approved,
            approved_time: approved ? now : 0,
            is_approved_admin: approved ? admin.name : "",
            edited_at: 0,
            school_calendar_events_id: eventId,
            note,
          })
        )
      );
      created.push(...chunk);
    }

    return NextResponse.json({ created }, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}
