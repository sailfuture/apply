import { xano } from "@/lib/xano";
import {
  SCHOOL_TIME_ZONE,
  appBaseUrl,
  formatSchoolTime,
} from "@/lib/school-calendar";
import { buildYearFamilies } from "@/lib/year-families";
import type { VolunteerHoursRecapContext } from "@/lib/emails/templates";

/** Annual goal, in lockstep with the admin page and the parent
 *  dashboard. */
export const VOLUNTEER_HOURS_GOAL = 40;

/** `template` value on the email log rows these sends write. */
export const VOLUNTEER_RECAP_TAG = "volunteer-hours-recap";

/** How many upcoming events one email lists. */
const UPCOMING_LIMIT = 8;

/** One enrolled family's recap: who it goes to and what it says. */
export interface VolunteerRecapFamily {
  id: number;
  name: string;
  students: string;
  /** Every parent address on the family; empty = can't be emailed. */
  emails: string[];
  context: VolunteerHoursRecapContext;
}

export interface VolunteerRecaps {
  yearName: string;
  families: VolunteerRecapFamily[];
}

/** "2026-09-12" → "Sep 12, 2026", by parts so it never shifts a day. */
function fmtDay(iso: string): string {
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  if (!y || !m || !d) return iso ?? "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Today's date on the school's clock, "YYYY-MM-DD". */
function schoolToday(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/**
 * Builds the recap for every ENROLLED family of one school year from
 * the same tables the admin Volunteer Hours page reads, so the email
 * and the page always agree: completed = approved hours, remaining =
 * goal minus approved.
 *
 * Any failed read THROWS. A recap built from half the data would tell
 * a family they have fewer hours than they do, so nothing is sent.
 */
export async function loadVolunteerRecaps(
  yearId: number
): Promise<VolunteerRecaps> {
  const [
    year,
    allEntries,
    families,
    days,
    allEvents,
    fap,
    srp,
    applications,
    students,
    parents,
  ] = await Promise.all([
    xano.schoolYears.getById(yearId),
    xano.volunteerHours.getAll(),
    xano.families.getAll(),
    xano.schoolCalendar.getByYear(yearId),
    xano.schoolCalendarEvents.getAll(),
    xano.familyApplicationProgress.getByYear(yearId),
    xano.studentRegistrationProgress.getByYear(yearId),
    xano.applications.getAll(),
    xano.students.getAll(),
    xano.parents.getAll(),
  ]);

  const yearName = (year.year_name ?? "").trim().replace(/\s*-\s*/, "–");

  const dateByDay = new Map(days.map((d) => [d.id, d.date]));
  const events = allEvents
    .filter((e) => dateByDay.has(Number(e.school_calendar_id)))
    .map((e) => ({
      ...e,
      date: dateByDay.get(Number(e.school_calendar_id)) ?? "",
    }));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const today = schoolToday();
  const upcoming = events
    .filter((e) => e.parent_volunteer_hours && e.date >= today)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start_time ?? 0) - (b.start_time ?? 0)
    )
    .slice(0, UPCOMING_LIMIT)
    .map((e) => {
      const time = formatSchoolTime(e.start_time);
      return {
        when: time ? `${fmtDay(e.date)} at ${time}` : fmtDay(e.date),
        title: (e.title ?? "").trim() || "School event",
        location: (e.location ?? "").trim(),
        hours: Number(e.volunteer_hour_total) || 0,
      };
    });

  const entriesByFamily = new Map<number, typeof allEntries>();
  for (const e of allEntries) {
    if (Number(e.registration_school_years_id) !== yearId) continue;
    const fid = Number(e.registration_families_id);
    const list = entriesByFamily.get(fid) ?? [];
    list.push(e);
    entriesByFamily.set(fid, list);
  }

  const parentById = new Map(parents.map((p) => [p.id, p]));
  const familyRowById = new Map(families.map((f) => [f.id, f]));
  const hoursUrl = `${appBaseUrl().replace(/\/+$/, "")}/dashboard/volunteer-hours`;

  const out: VolunteerRecapFamily[] = [];
  for (const f of buildYearFamilies({
    yearId,
    families,
    fap,
    srp,
    applications,
    students,
  })) {
    if (!f.enrolled) continue;
    const row = familyRowById.get(f.id);
    const emails: string[] = [];
    for (const pid of row ? xano.families.getParentIds(row) : []) {
      const email = (parentById.get(pid)?.email ?? "").trim().toLowerCase();
      if (email.includes("@") && !emails.includes(email)) emails.push(email);
    }

    const entries = [...(entriesByFamily.get(f.id) ?? [])].sort((a, b) =>
      (a.entry_date ?? "").localeCompare(b.entry_date ?? "")
    );
    const approved = entries.filter((e) => e.is_approved);
    const sum = (list: typeof entries) =>
      list.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const completed = sum(approved);

    out.push({
      id: f.id,
      name: f.name,
      students: f.students,
      emails,
      context: {
        year_name: yearName,
        goal_hours: VOLUNTEER_HOURS_GOAL,
        hours_completed: completed,
        hours_remaining: Math.max(0, VOLUNTEER_HOURS_GOAL - completed),
        hours_pending: sum(entries.filter((e) => !e.is_approved)),
        credited: approved.map((e) => {
          const ev = eventById.get(Number(e.school_calendar_events_id));
          // Linked entries read as the event; manual ones as the note
          // staff left (" " is the cleared-note sentinel).
          const label =
            (ev?.title ?? "").trim() ||
            (e.note ?? "").trim() ||
            "Volunteer hours";
          return {
            date: fmtDay(e.entry_date),
            label,
            hours: Number(e.hours) || 0,
          };
        }),
        upcoming,
        hours_url: hoursUrl,
      },
    });
  }

  return { yearName, families: out };
}
