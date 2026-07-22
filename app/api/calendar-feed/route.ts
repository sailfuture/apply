import { NextRequest } from "next/server";
import { xano } from "@/lib/xano";

/**
 * iCalendar (.ics) feed of every school-calendar event — the Google
 * Calendar sync option. Google (or Apple/Outlook) subscribes to the
 * URL and re-fetches it periodically, so events added or edited in
 * the admin calendar flow into staff/parent calendars automatically.
 *
 *   GET /api/calendar-feed?token=<CALENDAR_FEED_TOKEN>[&yearId=Y]
 *
 * Deliberately NOT Clerk-gated (calendar apps can't sign in) — the
 * route is exempted in proxy.ts and guarded by a secret token
 * instead: no CALENDAR_FEED_TOKEN env or a wrong token → 404. With
 * no yearId the feed spans every school year, so one subscription
 * stays valid across years.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CALENDAR_FEED_TOKEN;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!secret || token !== secret) {
    return new Response("Not found", { status: 404 });
  }

  const yearId = Number(req.nextUrl.searchParams.get("yearId"));
  const filterYear = Number.isFinite(yearId) && yearId > 0;

  const [days, events] = await Promise.all([
    xano.schoolCalendar.getAll().catch(() => []),
    xano.schoolCalendarEvents.getAll().catch(() => []),
  ]);
  const dayById = new Map(days.map((d) => [d.id, d]));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SailFuture Academy//School Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:SailFuture Academy",
    "X-WR-TIMEZONE:America/New_York",
  ];

  for (const e of events) {
    const day = dayById.get(Number(e.school_calendar_id));
    if (!day) continue;
    if (filterYear && Number(day.schoolyears_id) !== yearId) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:school-event-${e.id}@sailfuture.org`);
    lines.push(`DTSTAMP:${fmtUtc(e.created_at || Date.now())}`);
    if (e.start_time) {
      // Timed event — times are stored as unix-ms, emitted as UTC.
      lines.push(`DTSTART:${fmtUtc(e.start_time)}`);
      lines.push(
        `DTEND:${fmtUtc(e.end_time || e.start_time + 3_600_000)}`
      );
    } else {
      // All-day — DATE values; DTEND is exclusive (next day).
      lines.push(`DTSTART;VALUE=DATE:${day.date.replace(/-/g, "")}`);
      lines.push(`DTEND;VALUE=DATE:${nextDate(day.date)}`);
    }
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.location?.trim()) {
      lines.push(fold(`LOCATION:${esc(e.location.trim())}`));
    }
    const descParts = [
      e.description?.trim() ?? "",
      e.mandatory ? "Mandatory attendance." : "",
      e.parent_volunteer_hours
        ? `Counts toward parent volunteer hours (${e.volunteer_hour_total || 0} hrs).`
        : "",
    ].filter(Boolean);
    if (descParts.length > 0) {
      lines.push(fold(`DESCRIPTION:${esc(descParts.join("\n"))}`));
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sailfuture.ics"',
      // Calendar apps poll on their own schedule; short server cache
      // just smooths bursts.
      "Cache-Control": "public, max-age=900",
    },
  });
}

/** unix-ms → RFC 5545 UTC stamp (YYYYMMDDTHHMMSSZ). */
function fmtUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** "YYYY-MM-DD" → next day as "YYYYMMDD" (exclusive all-day DTEND). */
function nextDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

/** RFC 5545 text escaping. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold long content lines at 74 octets (continuation = space). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  parts.push(rest);
  return parts.join("\r\n");
}
