import {
  applyCallRecording,
  applyCallTranscript,
  callFromQuoCall,
  loadIngestContext,
  textFromQuoMessage,
  upsertQuoCall,
  upsertQuoText,
  type IngestOutcome,
} from "@/lib/quo/ingest";
import {
  getCallRecordings,
  getCallTranscript,
  isQuoConfigured,
  listCalls,
  listConversations,
  listMessages,
} from "@/lib/quo";
import { isSchoolNumber } from "@/lib/school-phones";
import { contactMessageKeys, normPhone } from "@/lib/sms/contacts";
import { xano } from "@/lib/xano";

/**
 * Backstop for the webhook: read the Main Line's recent conversations
 * and calls straight from Quo and upsert whatever is missing. Catches
 * events the webhook never got (it's still beta on Quo's side), and
 * doubles as the backfill for the days before the webhook existed.
 *
 * Recordings and transcripts aren't in the call list; for recent
 * answered calls that don't have one yet, a capped number are looked
 * up per run so a long backfill can't run past the function limit.
 */

const DEFAULT_LOOKBACK_MS = 3 * 86_400_000;
const DETAIL_LOOKUPS_PER_RUN = 15;
/** Quo finishes a recording and transcript within minutes of the call.
 *  A routine run only asks about calls this fresh — an older call
 *  without a recording wasn't recorded, and asking again every 15
 *  minutes would never change that. A backfill asks about all of them. */
const DETAIL_FRESH_MS = 6 * 3_600_000;

export interface QuoSyncResult {
  ok: boolean;
  skipped?: "not_configured";
  error?: string;
  since: string;
  conversations: number;
  texts: Record<string, number>;
  calls: Record<string, number>;
  detailsLooked: number;
  /** Unattributed calls that now match a lead or family. */
  reattributed: number;
}

function count(into: Record<string, number>, outcome: IngestOutcome) {
  into[outcome] = (into[outcome] ?? 0) + 1;
}

let inFlight: Promise<QuoSyncResult> | null = null;

export interface QuoSyncOptions {
  since?: number;
  /** Look up recordings/transcripts for every call in the window, not
   *  just fresh ones — for a backfill. */
  allDetails?: boolean;
}

export function syncQuoMainLine(opts: QuoSyncOptions = {}): Promise<QuoSyncResult> {
  if (inFlight) return inFlight;
  inFlight = run(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run({ since, allDetails = false }: QuoSyncOptions): Promise<QuoSyncResult> {
  const sinceMs = since ?? Date.now() - DEFAULT_LOOKBACK_MS;
  const sinceIso = new Date(sinceMs).toISOString();
  const result: QuoSyncResult = {
    ok: true,
    since: sinceIso,
    conversations: 0,
    texts: {},
    calls: {},
    detailsLooked: 0,
    reattributed: 0,
  };
  if (!isQuoConfigured()) return { ...result, ok: false, skipped: "not_configured" };

  try {
    const ctx = await loadIngestContext();

    // Texts: conversations touched since `since`, then each parent's
    // messages in that window.
    const conversations = await listConversations(ctx.mainLineId, { updatedAfter: sinceIso });
    result.conversations = conversations.length;
    const participants = new Set<string>();
    for (const c of conversations) {
      for (const p of c.participants ?? []) {
        if (p && !isSchoolNumber(p)) participants.add(p);
      }
    }
    for (const participant of participants) {
      const messages = await listMessages(ctx.mainLineId, participant, { createdAfter: sinceIso });
      // Oldest first so ids follow send order.
      for (const m of [...messages].reverse()) {
        count(result.texts, await upsertQuoText(textFromQuoMessage(m), ctx));
      }
    }

    // Calls, with summary + voicemail already included by the list.
    const calls = await listCalls(ctx.mainLineId, { createdAfter: sinceIso });
    const needDetails: string[] = [];
    for (const c of [...calls].reverse()) {
      const { outcome, row } = await upsertQuoCall(callFromQuoCall(c, ctx), ctx);
      count(result.calls, outcome);
      const fresh =
        allDetails ||
        (row?.completed_at ?? 0) > Date.now() - DETAIL_FRESH_MS;
      if (
        row &&
        fresh &&
        row.duration_seconds > 0 &&
        !row.recording_id &&
        needDetails.length < DETAIL_LOOKUPS_PER_RUN
      ) {
        needDetails.push(c.id);
      }
    }
    for (const id of needDetails) {
      result.detailsLooked += 1;
      const [recordings, transcript] = await Promise.all([
        getCallRecordings(id),
        getCallTranscript(id),
      ]);
      await applyCallRecording(id, recordings, ctx);
      await applyCallTranscript(id, transcript?.dialogue, ctx);
    }

    // Calls from a number that had no record when they came in attach
    // to the lead or family once one exists — the same healing the
    // Twilio sync does for texts.
    for (const row of await xano.calls.getAll()) {
      if (
        row.registration_families_id ||
        row.registration_inquiry_id ||
        row.registration_summer_camp_id ||
        row.website_liability_waiver_id ||
        row.tasco_summer_visit_id
      ) {
        continue;
      }
      const contact = ctx.directory.get(normPhone(row.counterparty));
      if (!contact) continue;
      try {
        await xano.calls.update(row.id, contactMessageKeys(contact));
        result.reattributed += 1;
      } catch (err) {
        console.error(`[quo/sync] re-attribution failed for call ${row.id}:`, err);
      }
    }
    return result;
  } catch (err) {
    console.error("[quo/sync] failed:", err);
    return { ...result, ok: false, error: err instanceof Error ? err.message : "Quo sync failed" };
  }
}

/** Unix ms of the newest Quo text or call Apply has — the natural
 *  "sync from here" for the cron, with a margin for late events. */
export async function lastQuoActivity(): Promise<number | null> {
  const [texts, calls] = await Promise.all([
    xano.smsMessages.getSince(Date.now() - 14 * 86_400_000),
    xano.calls.getAll(),
  ]);
  let latest = 0;
  for (const m of texts) if (m.provider === "quo") latest = Math.max(latest, m.created_at);
  for (const c of calls) latest = Math.max(latest, c.started_at);
  return latest || null;
}
