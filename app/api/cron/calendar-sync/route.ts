import { NextRequest, NextResponse } from "next/server";
import {
  isGoogleCalendarConfigured,
  listCalendarEvents,
  impersonatedEmail,
} from "@/lib/google-calendar";
import { buildFamilyByParentEmail } from "@/lib/store-server";
import { liveTourEventId, xano } from "@/lib/xano";

/**
 * Google Calendar → family appointment sync. Runs every 5 minutes
 * via Vercel Cron (see vercel.json).
 *
 * Every appointment lands on the impersonated admissions@ calendar
 * (bookings from Google appointment schedules, staff-created events,
 * everything) — this sweep reads a rolling window of that calendar,
 * matches each event's outside attendees against the parent roster
 * by email, and mirrors matches into `google_appointments`. The
 * mirror is what the parent Notifications log and the admin family
 * activity feed read, so a booking surfaces to the family within a
 * sync tick without anyone touching the app.
 *
 * Rules:
 *   - Tour events the app created itself are SKIPPED — they already
 *     flow through `registration_tours` and its own comms logging.
 *   - Events with no attendee matching a parent email are ignored
 *     (staff meetings, personal events); count reported for the log.
 *   - Upsert by `google_event_id`: reschedules update times, Google
 *     cancellations flip `status` to "cancelled" — no duplicates.
 *   - All-day events (no dateTime) carry startMs 0 and are skipped:
 *     appointments are timed by definition.
 *
 * Auth matches the other crons: Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; unset env (local dev) leaves
 * the endpoint open for manual spot-checks.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Rolling sync window: recently-past events still get status
 *  updates (a same-day cancellation), and bookings rarely land
 *  further out than a season. */
const WINDOW_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 120 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;
  if (expected && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ skipped: "google-calendar-not-configured" });
  }

  try {
    const now = Date.now();
    const [events, familyByEmail, students, inquiries, tours, existing] =
      await Promise.all([
      listCalendarEvents(now - WINDOW_PAST_MS, now + WINDOW_FUTURE_MS),
      buildFamilyByParentEmail(),
      xano.students.getAll().catch(() => []),
      xano.inquiries.getAll().catch(() => []),
      xano.tours.getAll().catch(() => []),
      // Null = the mirror table isn't reachable (not created yet) —
      // a clean 200 skip below, NOT a cron failure: the sync simply
      // starts working the tick after the table exists.
      xano.googleAppointments.getAll().catch((err) => {
        console.error("[calendar-sync] google_appointments unavailable:", err);
        return null;
      }),
    ]);
    if (existing === null) {
      return NextResponse.json({
        skipped: "google_appointments table not reachable — create it in Xano",
      });
    }
    if (!familyByEmail) {
      // Roster unavailable — nothing can match; let the next tick try.
      return NextResponse.json(
        { error: "parent roster unavailable" },
        { status: 503 }
      );
    }

    // Google event ids the app's own tour flow owns (live or
    // canceled — either way the tour pipeline is their record).
    const tourEventIds = new Set<string>();
    for (const t of tours) {
      const live = liveTourEventId(t.google_event_id);
      if (live) tourEventIds.add(live);
      if (
        typeof t.google_event_id === "string" &&
        t.google_event_id.startsWith("canceled:")
      ) {
        tourEventIds.add(t.google_event_id.slice("canceled:".length));
      }
    }

    const existingByEventId = new Map(
      existing.map((a) => [a.google_event_id, a])
    );
    const staffEmail = impersonatedEmail().toLowerCase();

    // Fallback matcher: student full name → family. Booking forms
    // often capture the student's name (Google appends form answers
    // to the event description) even when the parent booked with an
    // email we don't have on file. Guards against name-matching's
    // failure modes:
    //   - full "first last" only, normalized — never last name alone
    //   - names under 6 chars skipped (too easy to hit by accident)
    //   - a name shared by students in DIFFERENT families maps to
    //     null and never matches (ambiguous)
    const familyByStudentName = new Map<string, number | null>();
    for (const s of students) {
      if (s.isArchived === true) continue;
      const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const fid = Number(s.registration_families_id) || 0;
      if (name.length < 6 || !name.includes(" ") || !fid) continue;
      if (
        familyByStudentName.has(name) &&
        familyByStudentName.get(name) !== fid
      ) {
        familyByStudentName.set(name, null); // ambiguous across families
      } else if (!familyByStudentName.has(name)) {
        familyByStudentName.set(name, fid);
      }
    }

    // Second-tier matchers: INQUIRIES. Families book tours before
    // they have portal accounts, so the booker usually isn't in the
    // parent roster yet — but they filled out an inquiry. Same email
    // + student-name nets, same ambiguity guards; archived inquiries
    // (parked duplicates) never match.
    const inquiryByEmail = new Map<string, number>();
    const inquiryByStudentName = new Map<string, number | null>();
    for (const i of inquiries) {
      if ((i.status ?? "").trim() === "archived") continue;
      const email = (i.primary_email ?? "").trim().toLowerCase();
      if (email && !inquiryByEmail.has(email)) {
        inquiryByEmail.set(email, i.id);
      }
      const name = `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (name.length < 6 || !name.includes(" ")) continue;
      if (
        inquiryByStudentName.has(name) &&
        inquiryByStudentName.get(name) !== i.id
      ) {
        inquiryByStudentName.set(name, null); // two inquiries, same name
      } else if (!inquiryByStudentName.has(name)) {
        inquiryByStudentName.set(name, i.id);
      }
    }

    let created = 0;
    let updated = 0;
    let unmatched = 0;

    for (const event of events) {
      if (!event.id || !event.startMs) continue; // all-day / malformed
      if (tourEventIds.has(event.id)) continue; // app-created tour

      // The booker: first non-staff, non-resource attendee whose
      // email matches a parent on file.
      let familyId = 0;
      let matchedEmail = "";
      for (const a of event.attendees) {
        const email = (a.email ?? "").trim().toLowerCase();
        if (!email || a.resource || email === staffEmail) continue;
        if (email.endsWith("@sailfuture.org")) continue;
        const fid = familyByEmail.get(email);
        if (fid) {
          familyId = fid;
          matchedEmail = email;
          break;
        }
      }

      // Email missed → look for a student's full name in the event
      // text (title + description, where Google appends booking-form
      // answers). First unambiguous hit wins; a second hit pointing
      // at a DIFFERENT family voids the match entirely rather than
      // guessing between siblingsless strangers.
      const haystack = `${event.summary} ${event.description}`
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!familyId) {
        for (const [name, fid] of familyByStudentName) {
          if (!fid || !haystack.includes(name)) continue;
          if (familyId && familyId !== fid) {
            familyId = 0; // two different families named — ambiguous
            break;
          }
          familyId = fid;
        }
      }

      // Family nets missed → the booker is likely a pre-account lead.
      // Same email-then-student-name order against the inquiry table;
      // a match here logs into the lead's comms log instead of a
      // family surface.
      let inquiryId = 0;
      if (!familyId) {
        for (const a of event.attendees) {
          const email = (a.email ?? "").trim().toLowerCase();
          if (!email || a.resource || email === staffEmail) continue;
          if (email.endsWith("@sailfuture.org")) continue;
          const iid = inquiryByEmail.get(email);
          if (iid) {
            inquiryId = iid;
            matchedEmail = email;
            break;
          }
        }
        if (!inquiryId) {
          for (const [name, iid] of inquiryByStudentName) {
            if (!iid || !haystack.includes(name)) continue;
            if (inquiryId && inquiryId !== iid) {
              inquiryId = 0; // ambiguous across inquiries
              break;
            }
            inquiryId = iid;
          }
        }
      }

      const row = existingByEventId.get(event.id);
      if (!familyId && !inquiryId && !row) {
        // Never matched, never mirrored — not ours to track.
        unmatched++;
        continue;
      }

      const status = event.status === "cancelled" ? "cancelled" : "confirmed";
      if (!row) {
        await xano.googleAppointments.create({
          google_event_id: event.id,
          registration_families_id: familyId,
          registration_inquiry_id: inquiryId,
          title: event.summary || "Appointment",
          location: event.location ?? "",
          start_at: event.startMs,
          end_at: event.endMs || event.startMs,
          status,
          attendee_email: matchedEmail,
          last_synced_at: now,
        });
        created++;
        // Inquiry-matched → put the booking on the lead's comms
        // timeline, where admissions actually works pre-account
        // leads. Best-effort: a failed note never fails the sync.
        if (inquiryId && status !== "cancelled") {
          await writeAppointmentNote(inquiryId, "booked", event);
        }
        continue;
      }

      // Already mirrored — update only when something meaningful
      // moved, so quiet ticks don't churn Xano writes.
      const changed =
        row.title !== (event.summary || "Appointment") ||
        Number(row.start_at) !== event.startMs ||
        Number(row.end_at) !== (event.endMs || event.startMs) ||
        (row.location ?? "") !== (event.location ?? "") ||
        row.status !== status;
      if (changed) {
        await xano.googleAppointments.update(row.id, {
          title: event.summary || "Appointment",
          location: event.location ?? "",
          start_at: event.startMs,
          end_at: event.endMs || event.startMs,
          status,
          last_synced_at: now,
        });
        updated++;
        // Cancellation of an inquiry-linked booking → close the loop
        // on the lead's timeline too.
        if (
          Number(row.registration_inquiry_id) > 0 &&
          status === "cancelled" &&
          row.status !== "cancelled"
        ) {
          await writeAppointmentNote(
            Number(row.registration_inquiry_id),
            "cancelled",
            event
          );
        }
      }
    }

    console.log(
      `[calendar-sync] scanned=${events.length} created=${created} updated=${updated} unmatched=${unmatched}`
    );
    return NextResponse.json({
      scanned: events.length,
      created,
      updated,
      unmatched,
    });
  } catch (err) {
    console.error("[calendar-sync] failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

/**
 * One "appointment booked / cancelled" entry on an inquiry's comms
 * timeline. Same note shape the tour flow writes (see
 * lib/tour-notes.ts) — the inquiry FK column is long-verified wired,
 * so no echo guard needed. Never throws: the mirror row has already
 * landed, and a lost note must not fail the sync tick.
 */
async function writeAppointmentNote(
  inquiryId: number,
  kind: "booked" | "cancelled",
  event: { summary: string; location: string; startMs: number }
): Promise<void> {
  const when = event.startMs
    ? new Date(event.startMs).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : "";
  const body =
    kind === "booked"
      ? [
          `Appointment booked via Google Calendar — ${event.summary || "Appointment"}`,
          when,
          event.location?.trim(),
        ]
          .filter(Boolean)
          .join(" · ")
      : `Appointment cancelled — ${event.summary || "Appointment"}${when ? ` · ${when}` : ""}`;
  try {
    await xano.adminNotes.create({
      registration_families_id: 0,
      registration_students_id: null,
      registration_school_years_id: null,
      registration_inquiry_id: inquiryId,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: "",
      author_name: "Google Calendar",
      body,
      category: "tour",
      is_pinned: false,
      section: null,
      is_shared_with_parent: false,
    });
  } catch (err) {
    console.error(
      `[calendar-sync] failed to write appointment note for inquiry ${inquiryId}:`,
      err
    );
  }
}
