import { createSign } from "crypto";

/**
 * Google Calendar client for scheduled campus tours — service-account
 * auth with domain-wide delegation, no `googleapis` dependency (the
 * two REST calls we need don't justify the ~10 MB package).
 *
 * How the auth works: the service account signs a JWT asserting "act
 * as GOOGLE_CALENDAR_IMPERSONATE" (a real sailfuture.org user — this
 * is what domain-wide delegation authorizes), exchanges it for an
 * access token, and calls the Calendar API as that user. Events land
 * on the impersonated user's calendar, and because the parent is an
 * attendee with `sendUpdates=all`, GOOGLE sends the invite email and
 * tracks the RSVP — we never send calendar mail ourselves.
 *
 * Env (all four required for the integration to be "configured"):
 *   - GOOGLE_CALENDAR_CLIENT_EMAIL — service account's client_email
 *   - GOOGLE_CALENDAR_PRIVATE_KEY  — service account's private_key
 *     (paste with literal \n escapes; normalized below)
 *   - GOOGLE_CALENDAR_IMPERSONATE  — workspace user whose calendar
 *     owns tour events (e.g. hthompson@sailfuture.org)
 *   - GOOGLE_CALENDAR_ID           — optional, defaults to "primary"
 *     (the impersonated user's own calendar)
 *   - GOOGLE_SCHOOL_CALENDAR_ID    — separate opt-in for the
 *     school-calendar event push (see the school-event section below):
 *     the shared school calendar's id, which the impersonated user
 *     must be able to write to
 *
 * Unset env degrades gracefully: `isGoogleCalendarConfigured()` is
 * false, callers skip the sync, and tours still work app-side — the
 * same contract the Resend layer honors when RESEND_API_KEY is unset.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";

/** Display timezone for tour events. Times are sent as UTC instants,
 *  so this only controls how Google renders them. */
const TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || "America/New_York";

/** First whitespace-delimited token of an env value. Dashboard paste
 *  accidents (the same address pasted twice, a trailing newline)
 *  otherwise reach Google verbatim and fail with a cryptic
 *  invalid_request — an email can never contain whitespace, so the
 *  first token is always the intended value. */
function cleanEmail(v: string): string {
  return v.trim().split(/\s+/)[0] ?? "";
}

function getConfig(): {
  clientEmail: string;
  privateKey: string;
  impersonate: string;
  calendarId: string;
} | null {
  const clientEmail = cleanEmail(process.env.GOOGLE_CALENDAR_CLIENT_EMAIL ?? "");
  const rawKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
  const impersonate = cleanEmail(process.env.GOOGLE_CALENDAR_IMPERSONATE ?? "");
  if (!clientEmail || !rawKey || !impersonate) return null;
  return {
    clientEmail,
    // Vercel/.env values carry the PEM newlines as literal "\n".
    privateKey: rawKey.replace(/\\n/g, "\n"),
    impersonate,
    calendarId: (process.env.GOOGLE_CALENDAR_ID ?? "").trim() || "primary",
  };
}

export function isGoogleCalendarConfigured(): boolean {
  return getConfig() !== null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// One token per server instance, reused until shortly before expiry —
// the exchange costs a round trip and tokens live an hour.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("Google Calendar is not configured");
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: config.clientEmail,
      sub: config.impersonate,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    })
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(config.privateKey);
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${await res.text()}`
    );
  }
  const data = await res.json();
  if (!data?.access_token) {
    throw new Error("Google token exchange returned no access_token");
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

async function calendarFetch(
  path: string,
  init: RequestInit & { query?: Record<string, string>; calendarId?: string } = {}
): Promise<Response> {
  const config = getConfig();
  if (!config) throw new Error("Google Calendar is not configured");
  const token = await getAccessToken();
  const { query, calendarId, ...rest } = init;
  const qs = new URLSearchParams(query ?? {}).toString();
  const url =
    `${API_BASE}/calendars/${encodeURIComponent(calendarId ?? config.calendarId)}${path}` +
    (qs ? `?${qs}` : "");
  return fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
  });
}

export interface TourEventInput {
  summary: string;
  description: string;
  location: string;
  /** Unix ms. */
  startMs: number;
  endMs: number;
  /** The parent — Google emails them the invite. Empty = event with
   *  no attendee (still lands on the staff calendar). */
  attendeeEmail: string;
  attendeeName: string;
}

function eventBody(input: TourEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: {
      dateTime: new Date(input.startMs).toISOString(),
      timeZone: TIME_ZONE,
    },
    end: {
      dateTime: new Date(input.endMs).toISOString(),
      timeZone: TIME_ZONE,
    },
    attendees: input.attendeeEmail
      ? [
          {
            email: input.attendeeEmail,
            displayName: input.attendeeName || undefined,
          },
        ]
      : [],
    // Popup the staff calendar 30 min out; the parent's copy uses
    // their own defaults.
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    },
  };
}

/** Create the calendar event + emailed invite. Returns Google's event
 *  id (store it on the tour row). Throws on failure — callers treat
 *  the sync as best-effort and surface a warning. */
export async function createTourEvent(
  input: TourEventInput
): Promise<{ id: string; htmlLink: string | null }> {
  const res = await calendarFetch("/events", {
    method: "POST",
    query: { sendUpdates: "all" },
    body: JSON.stringify(eventBody(input)),
  });
  if (!res.ok) {
    throw new Error(
      `Google Calendar create failed (${res.status}): ${await res.text()}`
    );
  }
  const data = await res.json();
  if (!data?.id) throw new Error("Google Calendar create returned no id");
  return { id: data.id, htmlLink: data.htmlLink ?? null };
}

/** Reschedule/edit — Google emails attendees the update. */
export async function updateTourEvent(
  eventId: string,
  input: TourEventInput
): Promise<void> {
  const res = await calendarFetch(`/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    query: { sendUpdates: "all" },
    body: JSON.stringify(eventBody(input)),
  });
  if (!res.ok) {
    throw new Error(
      `Google Calendar update failed (${res.status}): ${await res.text()}`
    );
  }
}

/** Delete the event — Google emails attendees the cancellation.
 *  Already-gone events (404/410) count as success: the goal state is
 *  "no event", and re-canceling after a partial failure must not
 *  error forever. */
export async function cancelTourEvent(eventId: string): Promise<void> {
  const res = await calendarFetch(`/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    query: { sendUpdates: "all" },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(
      `Google Calendar delete failed (${res.status}): ${await res.text()}`
    );
  }
}

export interface CalendarEventAttendee {
  email: string;
  displayName: string;
  responseStatus: string;
  organizer: boolean;
  resource: boolean;
}

/** One calendar event, simplified to what the tour sync needs. */
export interface CalendarEvent {
  id: string;
  /** "confirmed" | "tentative" | "cancelled". */
  status: string;
  summary: string;
  description: string;
  location: string;
  /** 0 for all-day events (which can't be tours). */
  startMs: number;
  endMs: number;
  attendees: CalendarEventAttendee[];
}

/**
 * Events on the tour calendar inside [timeMinMs, timeMaxMs] —
 * recurring events expanded, and CANCELLED events included so the
 * sync can notice a parent canceling a website booking from their
 * own Google invite. Pages through `nextPageToken`; the windows we
 * ask for (a few months) stay well under the safety cap.
 */
export async function listCalendarEvents(
  timeMinMs: number,
  timeMaxMs: number
): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await calendarFetch("/events", {
      method: "GET",
      query: {
        timeMin: new Date(timeMinMs).toISOString(),
        timeMax: new Date(timeMaxMs).toISOString(),
        singleEvents: "true",
        showDeleted: "true",
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(
        `Google Calendar list failed (${res.status}): ${await res.text()}`
      );
    }
    const data = await res.json();
    const items: Array<Record<string, unknown>> = Array.isArray(data?.items)
      ? data.items
      : [];
    for (const item of items) {
      const start = item.start as { dateTime?: string } | undefined;
      const end = item.end as { dateTime?: string } | undefined;
      const attendees = Array.isArray(item.attendees)
        ? (item.attendees as Array<Record<string, unknown>>).map((a) => ({
            email: String(a.email ?? ""),
            displayName: String(a.displayName ?? ""),
            responseStatus: String(a.responseStatus ?? ""),
            organizer: a.organizer === true,
            resource: a.resource === true,
          }))
        : [];
      out.push({
        id: String(item.id ?? ""),
        status: String(item.status ?? ""),
        summary: String(item.summary ?? ""),
        description: String(item.description ?? ""),
        location: String(item.location ?? ""),
        startMs: start?.dateTime ? Date.parse(start.dateTime) || 0 : 0,
        endMs: end?.dateTime ? Date.parse(end.dateTime) || 0 : 0,
        attendees,
      });
    }
    pageToken =
      typeof data?.nextPageToken === "string" ? data.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return out;
}

/** The impersonated (staff) account — the sync uses this to tell the
 *  booker apart from the host on an event's attendee list. */
export function impersonatedEmail(): string {
  return getConfig()?.impersonate ?? "";
}

/** The calendar tour events actually land on, as an address usable in
 *  a calendar.google.com link — the explicit GOOGLE_CALENDAR_ID when
 *  one is set, otherwise the impersonated account (whose "primary"
 *  calendar is the default target). Empty when sync isn't configured. */
export function tourCalendarEmail(): string {
  const config = getConfig();
  if (!config) return "";
  return config.calendarId !== "primary"
    ? config.calendarId
    : config.impersonate;
}

/* ── School-calendar event push ───────────────────────────────────── */

/**
 * Deterministic Google event ids for school-calendar events —
 * `sfaschoolevent<rowId>`. Google lets clients choose event ids
 * (lowercase a–v + digits only, which this prefix satisfies), so the
 * app never stores a mapping: create, edit, and delete all address
 * the same id, and a re-push after a partial failure is idempotent.
 * The appointment-sync cron also uses the prefix to skip these events
 * when the school calendar and the appointments calendar are one.
 */
export const SCHOOL_EVENT_ID_PREFIX = "sfaschoolevent";

/** The shared school calendar events push to. Separate from
 *  GOOGLE_CALENDAR_ID (the admissions appointments calendar) so
 *  school-wide events don't flood the tour/appointment surface. The
 *  impersonated user must have write access to this calendar. */
function schoolCalendarId(): string {
  return (process.env.GOOGLE_SCHOOL_CALENDAR_ID ?? "").trim();
}

/** School-event push needs the base service-account envs PLUS
 *  GOOGLE_SCHOOL_CALENDAR_ID. Unset degrades gracefully — events keep
 *  flowing through the ICS feed subscription. */
export function isSchoolCalendarPushConfigured(): boolean {
  return getConfig() !== null && schoolCalendarId() !== "";
}

export interface SchoolEventInput {
  summary: string;
  description: string;
  location: string;
  /** The calendar day, "YYYY-MM-DD" — becomes the all-day date when
   *  no start time is set. */
  date: string;
  /** Unix ms; 0 = all-day. */
  startMs: number;
  endMs: number;
}

/**
 * `mode` controls the unused date variant. On PATCH the other variant
 * must be explicitly nulled — flipping a formerly all-day event to a
 * timed one 400s otherwise (and vice versa). On INSERT there is no
 * prior value to clear, and the nulls are just extra surface for
 * Google's validator to reject, so they're left out.
 */
function schoolEventBody(
  input: SchoolEventInput,
  mode: "patch" | "insert"
): Record<string, unknown> {
  const clear = mode === "patch";
  const base = {
    summary: input.summary,
    description: input.description,
    location: input.location,
  };
  if (input.startMs > 0) {
    const endMs =
      input.endMs > input.startMs ? input.endMs : input.startMs + 3_600_000;
    return {
      ...base,
      start: {
        dateTime: new Date(input.startMs).toISOString(),
        timeZone: TIME_ZONE,
        ...(clear ? { date: null } : {}),
      },
      end: {
        dateTime: new Date(endMs).toISOString(),
        timeZone: TIME_ZONE,
        ...(clear ? { date: null } : {}),
      },
    };
  }
  return {
    ...base,
    start: { date: input.date, ...(clear ? { dateTime: null } : {}) },
    // All-day DTEND is exclusive — the next day.
    end: {
      date: nextIsoDate(input.date),
      ...(clear ? { dateTime: null } : {}),
    },
  };
}

/** Pull the human-readable message out of a Google API error body,
 *  falling back to the raw text. Keeps route-level error strings
 *  readable instead of dumping a wall of JSON into a toast. */
function googleErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.error_description;
    if (typeof msg === "string" && msg) return msg;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Can the impersonated user actually WRITE to the school calendar?
 *
 * Run this before a bulk push: every per-event failure in a run has
 * the same cause when the cause is configuration, and 29 identical
 * failures are far less useful than one sentence naming the account
 * and the calendar. Uses `events.list` rather than `calendars.get`
 * because the delegated scope is `calendar.events` only — a
 * `calendars.get` preflight would 403 on a perfectly healthy setup.
 *
 * `events.list` also reports `accessRole`, so a calendar that is
 * readable but not writable is caught here rather than 29 events
 * later. That's the case worth catching: a subscribed calendar and a
 * view-only share both read fine and reject every write.
 */
export async function checkSchoolCalendarAccess(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const calendarId = schoolCalendarId();
  if (!calendarId) {
    return { ok: false, reason: "GOOGLE_SCHOOL_CALENDAR_ID is not set." };
  }
  const who = impersonatedEmail() || "the service account";
  let res: Response;
  try {
    res = await calendarFetch("/events", {
      method: "GET",
      calendarId,
      query: { maxResults: "1" },
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't reach Google Calendar: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (res.ok) {
    // Readable — but readable isn't writable. `events.list` reports
    // the caller's role on the calendar, so reject the read-only
    // ones here instead of letting every event fail on write.
    let role = "";
    try {
      role = String(JSON.parse(await res.text())?.accessRole ?? "");
    } catch {
      // No/!JSON body — fall through and let the writes speak.
    }
    if (role === "reader" || role === "freeBusyReader") {
      // A calendar added by subscribing to an iCal URL lives on
      // `@import.calendar.google.com` and is permanently read-only:
      // Google owns it and repopulates it from the source feed, so
      // no sharing change can make it writable. Worth calling out by
      // name — it looks like an ordinary calendar in the UI, and
      // pointing the push at one is an easy mistake when the app
      // also publishes an ICS feed you'd subscribe to.
      if (calendarId.endsWith("@import.calendar.google.com")) {
        return {
          ok: false,
          reason:
            `"${calendarId}" is a subscribed calendar — Google syncs it FROM an ` +
            `iCal feed and the API can't write to it, no matter how it's shared. ` +
            `Point GOOGLE_SCHOOL_CALENDAR_ID at a calendar the Workspace owns ` +
            `(Google Calendar → Other calendars + → Create new calendar), share ` +
            `it with ${who} as "Make changes to events", and copy its ID from ` +
            `Settings → Integrate calendar → Calendar ID.`,
        };
      }
      return {
        ok: false,
        reason:
          `${who} has read-only access ("${role}") to calendar "${calendarId}". ` +
          `Open that calendar's Settings → Share with specific people, add ` +
          `${who}, and set the permission to "Make changes to events".`,
      };
    }
    return { ok: true };
  }
  const detail = googleErrorMessage(await res.text().catch(() => ""));
  if (res.status === 404) {
    return {
      ok: false,
      reason:
        `Google can't find calendar "${calendarId}" for ${who}. Check that ` +
        `GOOGLE_SCHOOL_CALENDAR_ID is the calendar's ID (Calendar → Settings → ` +
        `Integrate calendar → Calendar ID), then share that calendar with ${who} ` +
        `with "Make changes to events".`,
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason:
        `${who} isn't allowed to use calendar "${calendarId}" (403: ${detail}). ` +
        `Share the calendar with ${who} and set the permission to ` +
        `"Make changes to events".`,
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      reason:
        `Google rejected the service-account credentials (401: ${detail}). ` +
        `Re-check domain-wide delegation for the calendar.events scope.`,
    };
  }
  return {
    ok: false,
    reason: `Google Calendar returned ${res.status} for "${calendarId}": ${detail}`,
  };
}

/** "YYYY-MM-DD" → the next day, same format. */
function nextIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Create-or-update a school event on the shared school calendar.
 * PATCH-first (edits are the repeat case, and a PATCH with
 * `status: "confirmed"` also resurrects an event a staffer deleted by
 * hand on Google); a 404 means never created → insert with the
 * deterministic id. Throws on failure — callers treat the push as
 * best-effort.
 */
export async function upsertSchoolEvent(
  rowId: number,
  input: SchoolEventInput
): Promise<void> {
  const calendarId = schoolCalendarId();
  if (!calendarId) throw new Error("GOOGLE_SCHOOL_CALENDAR_ID is not set");
  const googleId = `${SCHOOL_EVENT_ID_PREFIX}${rowId}`;

  const patchOnce = () =>
    calendarFetch(`/events/${googleId}`, {
      method: "PATCH",
      calendarId,
      body: JSON.stringify({
        ...schoolEventBody(input, "patch"),
        status: "confirmed",
      }),
    });

  const patch = await patchOnce();
  if (patch.ok) return;
  if (patch.status !== 404) {
    throw new Error(
      `Google Calendar school-event update failed (${patch.status}): ${googleErrorMessage(
        await patch.text()
      )}`
    );
  }

  const insert = await calendarFetch("/events", {
    method: "POST",
    calendarId,
    body: JSON.stringify({
      ...schoolEventBody(input, "insert"),
      id: googleId,
    }),
  });
  if (insert.ok) return;

  // 409 = the id is taken. PATCH said 404 and INSERT says "already
  // exists", which happens when the event is in a state the direct
  // GET/PATCH by id misses; one more PATCH resolves it rather than
  // failing this event forever.
  if (insert.status === 409) {
    const retry = await patchOnce();
    if (retry.ok) return;
    throw new Error(
      `Google Calendar school-event ${googleId} already exists but can't be updated (${retry.status}): ${googleErrorMessage(
        await retry.text()
      )}`
    );
  }

  // A 404 here is NOT "event missing" — the insert doesn't address an
  // event id — it means the calendar itself isn't reachable by the
  // impersonated user. Say so instead of reporting a create failure.
  if (insert.status === 404) {
    throw new Error(
      `Google can't find calendar "${calendarId}" for ${
        impersonatedEmail() || "the service account"
      } — check GOOGLE_SCHOOL_CALENDAR_ID and that the calendar is shared with that account with "Make changes to events".`
    );
  }
  throw new Error(
    `Google Calendar school-event create failed (${insert.status}): ${googleErrorMessage(
      await insert.text()
    )}`
  );
}

/** Remove a school event from the shared calendar. Already-gone
 *  (404/410) counts as success — the goal state is "no event". */
export async function deleteSchoolEvent(rowId: number): Promise<void> {
  const calendarId = schoolCalendarId();
  if (!calendarId) throw new Error("GOOGLE_SCHOOL_CALENDAR_ID is not set");
  const res = await calendarFetch(
    `/events/${SCHOOL_EVENT_ID_PREFIX}${rowId}`,
    { method: "DELETE", calendarId }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(
      `Google Calendar school-event delete failed (${res.status}): ${await res.text()}`
    );
  }
}

/** The parent's RSVP on an event ("accepted" | "declined" |
 *  "tentative" | "needsAction"), or null when the event/attendee
 *  can't be read. Never throws — RSVP display is decoration. */
export async function getTourRsvp(
  eventId: string,
  attendeeEmail: string
): Promise<string | null> {
  try {
    const res = await calendarFetch(
      `/events/${encodeURIComponent(eventId)}`,
      { method: "GET" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const attendees: Array<{ email?: string; responseStatus?: string }> =
      Array.isArray(data?.attendees) ? data.attendees : [];
    const match = attendees.find(
      (a) => (a.email ?? "").toLowerCase() === attendeeEmail.toLowerCase()
    );
    return match?.responseStatus ?? null;
  } catch {
    return null;
  }
}
