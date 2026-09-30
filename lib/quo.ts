import { MAIN_LINE } from "@/lib/school-phones";

/**
 * Server-only client for Quo (the school's phone system, formerly
 * OpenPhone). Plain fetch, like lib/twilio.ts. Reads QUO_API_KEY, so
 * never import it from a client component.
 *
 * Quo has two API surfaces right now, and this module hides the seam:
 *   - the legacy v1 API at /v1/… — phone numbers, users,
 *     conversations, messages, call summaries/voicemails
 *   - the versioned API at the root, selected by the
 *     `Quo-Api-Version: 2026-03-30` header — calls, recordings,
 *     transcripts, webhooks
 *
 * Only the Main Line is ever read or written from Apply (user
 * decision 2026-09-29: the Faculty Line is for teachers and stays
 * out of this app). `resolveMainLine` finds it by number.
 *
 * Quo allows 10 requests a second per key and answers 429 past that;
 * everything here goes through one process-wide throttle (8/s) and
 * retries 429/5xx with backoff.
 */

const V1_BASE = "https://api.quo.com/v1";
const VERSIONED_BASE = "https://api.quo.com";
export const QUO_API_VERSION = "2026-03-30";
const MAX_REQUESTS_PER_SECOND = 8;
const MAX_ATTEMPTS = 4;

/* ─────────────────────────────── Types ─────────────────────────────── */

export interface QuoPhoneNumber {
  id: string;
  name: string;
  number: string;
  formattedNumber: string | null;
  portingStatus?: string | null;
  users: { id: string; email?: string }[];
}

export interface QuoUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "owner" | "admin" | "member";
}

export interface QuoConversation {
  id: string;
  phoneNumberId: string;
  participants: string[];
  lastActivityAt: string | null;
  updatedAt: string | null;
}

export type QuoMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "undelivered"
  | "received"
  | "failed";

/** v1 message shape (list/get). */
export interface QuoMessage {
  id: string;
  to: string[];
  from: string;
  text: string;
  phoneNumberId: string | null;
  conversationId: string;
  direction: "incoming" | "outgoing";
  userId: string | null;
  status: QuoMessageStatus;
  createdAt: string;
  updatedAt: string;
  media?: { url: string; type?: string | null }[];
}

/** Versioned call shape (list/get). */
export interface QuoCall {
  id: string;
  phoneNumberId: string;
  actorId: string | null;
  direction: "incoming" | "outgoing";
  status: string;
  participants: { phoneNumber: string; actorId: string | null }[];
  answeredAt: string | null;
  answeredBy: string | null;
  initiatedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  duration: number;
  forwardedFrom: string | null;
  forwardedTo: string | null;
  /** Present when listed with `include=summary`. */
  summary?: {
    status?: string;
    summary?: string[] | null;
    nextSteps?: string[] | null;
  } | null;
  /** Present when listed with `include=voicemail`. */
  voicemail?: {
    id?: string;
    status?: string;
    duration?: number | null;
    recordingUrl?: string | null;
    transcript?: string | null;
  } | null;
}

export interface QuoRecording {
  id: string;
  status: string;
  startTime: string | null;
  duration: number | null;
  url: string | null;
  type: string | null;
}

export interface QuoTranscriptLine {
  content: string;
  start: number;
  end: number;
  identifier: string | null;
  /** Webhook payloads name the staffer `userId`… */
  userId?: string | null;
  /** …the versioned transcripts endpoint names them `actorId`. */
  actorId?: string | null;
}

export interface QuoTranscript {
  callId: string;
  createdAt?: string;
  duration?: number;
  status?: string;
  processingStatus?: string;
  dialogue: QuoTranscriptLine[] | null;
}

export interface QuoSummary {
  callId: string;
  status?: string;
  processingStatus?: string;
  summary: string[] | null;
  nextSteps: string[] | null;
}

export interface QuoVoicemail {
  id: string;
  duration: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  status: string;
}

export interface QuoWebhook {
  id: string;
  label: string | null;
  status: "enabled" | "disabled";
  url: string;
  events: string[];
  resourceIds: string[];
  /** Signing secret (`whsec_…`) — only returned on create/rotate. */
  key?: string;
}

interface QuoPage<T> {
  data: T[];
  nextPageToken?: string | null;
  nextCursor?: string | null;
}

/* ───────────────────────────── Errors ───────────────────────────── */

export class QuoApiError extends Error {
  status: number;
  title: string;
  constructor(status: number, message: string, title?: string) {
    super(message);
    this.name = "QuoApiError";
    this.status = status;
    this.title = title ?? (status ? `HTTP ${status}` : "Request failed");
  }
}

export function isQuoConfigured(): boolean {
  return Boolean(process.env.QUO_API_KEY);
}

/* ─────────────────────────── Throttled fetch ─────────────────────────── */

const requestStarts: number[] = [];
let gate: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function acquireSlot(): Promise<void> {
  const next = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (requestStarts.length && now - requestStarts[0] >= 1000) {
        requestStarts.shift();
      }
      if (requestStarts.length < MAX_REQUESTS_PER_SECOND) {
        requestStarts.push(now);
        return;
      }
      await sleep(1000 - (now - requestStarts[0]) + 15);
    }
  });
  gate = next.catch(() => undefined);
  return next;
}

type QueryValue = string | number | boolean | null | undefined | string[];

export async function quoFetch<T>(
  path: string,
  init: {
    method?: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    /** Root + version header instead of /v1. */
    versioned?: boolean;
  } = {}
): Promise<T> {
  const key = process.env.QUO_API_KEY;
  if (!key) {
    throw new QuoApiError(503, "Quo is not configured — set QUO_API_KEY.", "Not Configured");
  }
  const url = new URL((init.versioned ? VERSIONED_BASE : V1_BASE) + path);
  for (const [name, value] of Object.entries(init.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    // Quo wants repeated keys for arrays, no brackets.
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(name, v));
    else url.searchParams.set(name, String(value));
  }

  let lastError: QuoApiError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1) + Math.random() * 250);
    await acquireSlot();
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: key,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.versioned ? { "Quo-Api-Version": QUO_API_VERSION } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (err) {
      lastError = new QuoApiError(
        0,
        err instanceof Error ? err.message : "Network error reaching Quo",
        "Network Error"
      );
      continue;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return data as T;
    const error = new QuoApiError(
      res.status,
      String(data?.message ?? data?.description ?? `Quo API error ${res.status}`),
      typeof data?.title === "string" ? data.title : undefined
    );
    if (res.status === 429 || res.status >= 500) {
      lastError = error;
      continue;
    }
    throw error;
  }
  throw lastError ?? new QuoApiError(0, "Quo request failed");
}

/** Null when Quo says the thing isn't there (404) or isn't on the plan
 *  (403) instead of an exception. A 400 is a bug on our side and still
 *  throws. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof QuoApiError && [403, 404].includes(err.status)) return null;
    throw err;
  }
}

async function listAllPages<T>(
  path: string,
  query: Record<string, QueryValue>,
  opts: { limit?: number; pageSize?: number; versioned?: boolean } = {}
): Promise<T[]> {
  const limit = opts.limit ?? 2000;
  const pageSize = opts.pageSize ?? 100;
  const out: T[] = [];
  let token: string | undefined;
  do {
    const page = await quoFetch<QuoPage<T>>(path, {
      query: {
        ...query,
        maxResults: Math.min(pageSize, limit - out.length),
        pageToken: token,
      },
      versioned: opts.versioned,
    });
    out.push(...(page.data ?? []));
    token = page.nextPageToken ?? page.nextCursor ?? undefined;
  } while (token && out.length < limit);
  return out;
}

/* ─────────────────────── Directory (cached 5 min) ─────────────────────── */

const DIRECTORY_TTL_MS = 5 * 60_000;
let mainLineCache: { at: number; value: QuoPhoneNumber } | null = null;
let usersCache: { at: number; value: QuoUser[] } | null = null;

export async function listPhoneNumbers(): Promise<QuoPhoneNumber[]> {
  return (await quoFetch<{ data: QuoPhoneNumber[] }>("/phone-numbers")).data ?? [];
}

/** The office Main Line as Quo knows it. Throws if it isn't on the
 *  workspace — Apply never falls back to "some other number". */
export async function resolveMainLine(): Promise<QuoPhoneNumber> {
  if (mainLineCache && Date.now() - mainLineCache.at < DIRECTORY_TTL_MS) {
    return mainLineCache.value;
  }
  const numbers = await listPhoneNumbers();
  const main = numbers.find((n) => n.number === MAIN_LINE);
  if (!main) {
    throw new QuoApiError(404, `The Main Line ${MAIN_LINE} isn't on this Quo workspace.`, "No Main Line");
  }
  mainLineCache = { at: Date.now(), value: main };
  return main;
}

export async function listUsers(): Promise<QuoUser[]> {
  if (usersCache && Date.now() - usersCache.at < DIRECTORY_TTL_MS) {
    return usersCache.value;
  }
  // /users refuses pages over 50 (the other v1 lists take 100).
  const users = await listAllPages<QuoUser>("/users", {}, { pageSize: 50 });
  usersCache = { at: Date.now(), value: users };
  return users;
}

export function quoUserName(u: QuoUser | null | undefined): string {
  if (!u) return "";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "";
}

/** userId → display name + email, for attributing staff texts/calls. */
export async function quoUserDirectory(): Promise<
  Map<string, { name: string; email: string }>
> {
  const users = await listUsers().catch(() => [] as QuoUser[]);
  return new Map(
    users.map((u) => [u.id, { name: quoUserName(u), email: u.email ?? "" }])
  );
}

/* ─────────────────────── Conversations + messages ─────────────────────── */

export function listConversations(
  phoneNumberId: string,
  opts: { updatedAfter?: string; limit?: number } = {}
): Promise<QuoConversation[]> {
  return listAllPages<QuoConversation>(
    "/conversations",
    { phoneNumbers: [phoneNumberId], updatedAfter: opts.updatedAfter },
    { limit: opts.limit ?? 500 }
  );
}

/** Messages between the number and one participant, newest first. */
export function listMessages(
  phoneNumberId: string,
  participant: string,
  opts: { createdAfter?: string; limit?: number } = {}
): Promise<QuoMessage[]> {
  return listAllPages<QuoMessage>(
    "/messages",
    {
      phoneNumberId,
      participants: [participant],
      createdAfter: opts.createdAfter,
    },
    { limit: opts.limit ?? 500 }
  );
}

export async function getMessage(id: string): Promise<QuoMessage | null> {
  return optional(async () => (await quoFetch<{ data: QuoMessage }>(`/messages/${encodeURIComponent(id)}`)).data);
}

/* ─────────────────────────────── Calls ─────────────────────────────── */

/** Calls on one number, newest first, with Quo's summary and voicemail
 *  included when they exist. The versioned list pages with
 *  `limit`/`after` and filters with `createdAt[gte]`, unlike v1. */
export async function listCalls(
  phoneNumberId: string,
  opts: { createdAfter?: string; limit?: number } = {}
): Promise<QuoCall[]> {
  const limit = opts.limit ?? 500;
  const out: QuoCall[] = [];
  let after: string | undefined;
  do {
    const page = await quoFetch<QuoPage<QuoCall>>("/calls", {
      query: {
        phoneNumberId,
        "createdAt[gte]": opts.createdAfter,
        limit: Math.min(50, limit - out.length),
        after,
        include: ["summary", "voicemail"],
      },
      versioned: true,
    });
    out.push(...(page.data ?? []));
    after = page.nextCursor ?? undefined;
  } while (after && out.length < limit);
  return out;
}

export async function getCall(id: string): Promise<QuoCall | null> {
  return optional(async () => (await quoFetch<{ data: QuoCall }>(`/calls/${encodeURIComponent(id)}`, { versioned: true })).data);
}

export async function getCallRecordings(id: string): Promise<QuoRecording[]> {
  const res = await optional(() =>
    quoFetch<{ data: QuoRecording[] }>(`/calls/${encodeURIComponent(id)}/recordings`, { versioned: true })
  );
  return res?.data ?? [];
}

export async function getCallTranscript(id: string): Promise<QuoTranscript | null> {
  const res = await optional(() =>
    quoFetch<{ data: QuoTranscript[] | QuoTranscript }>(`/calls/${encodeURIComponent(id)}/transcripts`, { versioned: true })
  );
  const data = res?.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function getCallSummary(id: string): Promise<QuoSummary | null> {
  const res = await optional(() => quoFetch<{ data: QuoSummary }>(`/call-summaries/${encodeURIComponent(id)}`));
  return res?.data ?? null;
}

export async function getCallVoicemail(id: string): Promise<QuoVoicemail | null> {
  const res = await optional(() => quoFetch<{ data: QuoVoicemail }>(`/call-voicemails/${encodeURIComponent(id)}`));
  return res?.data ?? null;
}

/* ─────────────────────────────── Sending ─────────────────────────────── */

/** The Quo user id for a staff email, so a text sent from Apply shows
 *  in Quo as sent by that person. Null when they have no Quo account
 *  (Quo then attributes it to the line's owner). */
export async function quoUserIdByEmail(email: string | null | undefined): Promise<string | null> {
  const wanted = (email ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const users = await listUsers().catch(() => [] as QuoUser[]);
  return users.find((u) => (u.email ?? "").toLowerCase() === wanted)?.id ?? null;
}

/**
 * Send one text from the Main Line. One recipient per call — Quo's
 * `to` with several numbers makes a group thread that shows every
 * number to everyone. `markDone` keeps automated texts from opening a
 * conversation in the office inbox; a reply from the parent reopens
 * it. Quo answers with status "queued" or "sent"; the real outcome
 * (delivered / failed / undelivered) arrives on the webhook.
 */
export async function sendQuoText(input: {
  to: string;
  content: string;
  userId?: string | null;
  markDone?: boolean;
}): Promise<QuoMessage> {
  const mainLine = await resolveMainLine();
  const res = await quoFetch<{ data: QuoMessage }>("/messages", {
    method: "POST",
    body: {
      from: mainLine.id,
      to: [input.to],
      content: input.content,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.markDone ? { setInboxStatus: "done" } : {}),
    },
  });
  return res.data;
}

/* ───────────────────────────── Webhooks ───────────────────────────── */

export async function listWebhooks(): Promise<QuoWebhook[]> {
  return (await quoFetch<{ data: QuoWebhook[] }>("/webhooks", { versioned: true })).data ?? [];
}

export async function createWebhook(input: {
  url: string;
  events: string[];
  resourceIds: string[];
  label: string;
  status: "enabled" | "disabled";
}): Promise<QuoWebhook> {
  return (await quoFetch<{ data: QuoWebhook }>("/webhooks", { method: "POST", body: input, versioned: true })).data;
}

export async function updateWebhook(
  id: string,
  patch: Partial<{ url: string; events: string[]; resourceIds: string[]; label: string; status: "enabled" | "disabled" }>
): Promise<QuoWebhook> {
  return (await quoFetch<{ data: QuoWebhook }>(`/webhooks/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, versioned: true })).data;
}
