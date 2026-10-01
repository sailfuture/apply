import { xano, type XanoSmsMessage } from "@/lib/xano";
import { sendEmail } from "@/lib/emails/send";
import {
  smsDeliveryFiltered,
  smsDeliveryRecovered,
  type EmailContent,
} from "@/lib/emails/templates";
import {
  readDeliveryAlertState,
  writeDeliveryAlertState,
  type DeliveryAlertState,
} from "@/lib/app-settings";
import { formatUSPhone } from "@/lib/phone";

/**
 * Carrier-filtering watch for the texts Apply sends.
 *
 * On 2026-09-30 every text from the Main Line between 11:14 AM and
 * 10 PM came back `undelivered` with carrier code 30007 ("message
 * filtered") — 23 texts, ten of them discipline notices — and nobody
 * knew until the next morning, because each one just read "Not
 * delivered" in its own thread. This module looks at the recent
 * outbound log as a whole: when filtered texts outnumber delivered
 * ones it emails staff once, and again when delivery recovers.
 *
 * Runs from the quo-sync cron (every 15 minutes). Pure parts
 * (`summarizeDelivery`, `decideDeliveryAlert`) are fixture-tested; the
 * orchestrator takes its I/O as injectable deps for the same reason.
 */

/** Carrier code for "message filtered" (spam / content / velocity). */
export const FILTERED_ERROR_CODE = "30007";
/** How far back the watch looks. */
export const DELIVERY_WINDOW_MS = 2 * 3_600_000;
/** One alert per episode: no repeat inside this. */
export const ALERT_COOLDOWN_MS = 12 * 3_600_000;
/** A run of this many filtered texts in a row is an episode — one or
 *  two can be a bad number or a one-off content block. The same count
 *  of deliveries in a row ends it. */
export const MIN_FILTERED = 3;

export interface FilteredSample {
  to: string;
  at: number;
  template: string | null;
}

export interface DeliverySummary {
  since: number;
  delivered: number;
  /** Undelivered with the carrier-filtered code. */
  filtered: number;
  /** Undelivered or failed for any other reason (landline, dead number…). */
  undeliveredOther: number;
  /** Accepted by the provider, no final receipt yet. */
  pending: number;
  /** Newest first, at most 12. */
  filteredSample: FilteredSample[];
  /** How many of the most recent decided sends were filtered, counting
   *  back from the newest until a delivered one (other failures —
   *  landlines, dead numbers — are skipped, not counted). */
  tailFiltered: number;
  /** The same run for delivered sends, ended by a filtered one. */
  tailDelivered: number;
  /** The verdict the alert hangs on: the newest MIN_FILTERED decided
   *  sends were all filtered, or filtered sends in the window are at
   *  least MIN_FILTERED and outnumber delivered ones. The run catches
   *  an episode that starts right after a healthy blast (9/30: the
   *  morning's deliveries kept the ratio quiet for an hour); the ratio
   *  catches one where a few deliveries slip through. */
  filtering: boolean;
}

const FINAL_OK = new Set(["delivered"]);
const FINAL_BAD = new Set(["undelivered", "failed"]);

/** Outbound rows inside the window, bucketed by outcome. */
export function summarizeDelivery(
  rows: XanoSmsMessage[],
  now: number,
  windowMs = DELIVERY_WINDOW_MS
): DeliverySummary {
  const since = now - windowMs;
  const summary: DeliverySummary = {
    since,
    delivered: 0,
    filtered: 0,
    undeliveredOther: 0,
    pending: 0,
    filteredSample: [],
    tailFiltered: 0,
    tailDelivered: 0,
    filtering: false,
  };
  const sample: FilteredSample[] = [];
  // Decided sends in send order (time, then id), for the runs below.
  const decided: Array<{ at: number; id: number; kind: "delivered" | "filtered" | "other" }> = [];
  for (const m of rows) {
    const at = Number(m.created_at);
    if (m.direction !== "outbound" || !(at >= since) || at > now) continue;
    const status = m.status ?? "";
    if (FINAL_OK.has(status)) {
      summary.delivered++;
      decided.push({ at, id: m.id, kind: "delivered" });
    } else if (FINAL_BAD.has(status)) {
      if (String(m.error_code ?? "") === FILTERED_ERROR_CODE) {
        summary.filtered++;
        sample.push({ to: m.to_number, at, template: m.template ?? null });
        decided.push({ at, id: m.id, kind: "filtered" });
      } else {
        summary.undeliveredOther++;
        decided.push({ at, id: m.id, kind: "other" });
      }
    } else {
      summary.pending++;
    }
  }
  summary.filteredSample = sample.sort((a, b) => b.at - a.at).slice(0, 12);
  decided.sort((a, b) => b.at - a.at || b.id - a.id);
  for (const d of decided) {
    if (d.kind === "other") continue;
    if (d.kind === "filtered" && summary.tailDelivered === 0) summary.tailFiltered++;
    else if (d.kind === "delivered" && summary.tailFiltered === 0) summary.tailDelivered++;
    else break;
  }
  summary.filtering =
    summary.tailFiltered >= MIN_FILTERED ||
    (summary.filtered >= MIN_FILTERED && summary.filtered > summary.delivered);
  return summary;
}

export type DeliveryVerdict = "alert" | "recovered" | "quiet";

/**
 * Alert when filtering is on and no alert is open (or the last one is
 * older than the cooldown); recovered when an alert is open and the
 * newest MIN_FILTERED decided sends were all delivered; quiet otherwise.
 */
export function decideDeliveryAlert(
  summary: DeliverySummary,
  state: DeliveryAlertState,
  now: number
): DeliveryVerdict {
  if (summary.filtering) {
    if (state.alertedAt && now - state.alertedAt < ALERT_COOLDOWN_MS) return "quiet";
    return "alert";
  }
  if (state.alertedAt && summary.tailDelivered >= MIN_FILTERED) {
    return "recovered";
  }
  return "quiet";
}

/** "group:2:…" → "Group text", "nurture:inquiry_day2" → "Follow-up"… */
export function templateLabel(template: string | null): string {
  const t = template ?? "";
  if (!t || t === "manual") return "Manual text";
  if (t.startsWith("group")) return "Group text";
  if (t.startsWith("nurture:")) return "Automated follow-up";
  if (t.startsWith("website:")) return "Website welcome text";
  if (t.startsWith("discipline")) return "Discipline notice";
  const head = t.split(":")[0].replace(/_/g, " ");
  return head.charAt(0).toUpperCase() + head.slice(1);
}

export interface DeliveryAlertDeps {
  loadRows(since: number): Promise<XanoSmsMessage[]>;
  loadState(): Promise<DeliveryAlertState>;
  saveState(state: DeliveryAlertState): Promise<void>;
  send(content: EmailContent, tag: string): Promise<{ ok: boolean }>;
  appUrl(): string;
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org").replace(
    /\/$/,
    ""
  );
}

const defaultDeps: DeliveryAlertDeps = {
  loadRows: (since) => xano.smsMessages.getSince(since),
  loadState: readDeliveryAlertState,
  saveState: async (state) => {
    await writeDeliveryAlertState(state, "delivery-watch");
  },
  send: (content, tag) =>
    sendEmail({
      to: [process.env.SMS_ALERTS_EMAIL ?? "admissions@sailfuture.org"],
      content,
      tag,
    }),
  appUrl: appBase,
};

export interface DeliveryCheckResult {
  verdict: DeliveryVerdict;
  summary: DeliverySummary;
}

/**
 * One pass of the watch. Never throws past a failed read: a window
 * that can't be read is treated as quiet (the next run looks again),
 * and a failed email leaves the state untouched so it is retried.
 */
export async function checkDeliveryAndAlert(
  now = Date.now(),
  deps: DeliveryAlertDeps = defaultDeps
): Promise<DeliveryCheckResult> {
  const rows = await deps.loadRows(now - DELIVERY_WINDOW_MS).catch((err) => {
    console.error("[delivery-watch] couldn't read the text log:", err);
    return [] as XanoSmsMessage[];
  });
  const summary = summarizeDelivery(rows, now);
  const state = await deps.loadState();
  const verdict = decideDeliveryAlert(summary, state, now);

  if (verdict === "alert") {
    const filteredSince =
      state.filteredSince ??
      (summary.filteredSample.length
        ? Math.min(...summary.filteredSample.map((s) => s.at))
        : now);
    const sent = await deps.send(
      smsDeliveryFiltered({
        delivered: summary.delivered,
        filtered: summary.filtered,
        undeliveredOther: summary.undeliveredOther,
        windowHours: DELIVERY_WINDOW_MS / 3_600_000,
        filteredSince,
        examples: summary.filteredSample.map((s) => ({
          to: formatUSPhone(s.to),
          at: s.at,
          kind: templateLabel(s.template),
        })),
        appUrl: deps.appUrl(),
      }),
      "sms-delivery-filtered"
    );
    if (sent.ok) await deps.saveState({ alertedAt: now, filteredSince });
  } else if (verdict === "recovered") {
    const sent = await deps.send(
      smsDeliveryRecovered({
        delivered: summary.delivered,
        alertedAt: state.alertedAt ?? now,
        appUrl: deps.appUrl(),
      }),
      "sms-delivery-recovered"
    );
    if (sent.ok) await deps.saveState({ alertedAt: null, filteredSince: null });
  }
  return { verdict, summary };
}
