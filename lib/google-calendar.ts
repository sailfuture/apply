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
  init: RequestInit & { query?: Record<string, string> } = {}
): Promise<Response> {
  const config = getConfig();
  if (!config) throw new Error("Google Calendar is not configured");
  const token = await getAccessToken();
  const { query, ...rest } = init;
  const qs = new URLSearchParams(query ?? {}).toString();
  const url =
    `${API_BASE}/calendars/${encodeURIComponent(config.calendarId)}${path}` +
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
