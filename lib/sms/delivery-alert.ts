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
/** At least this many filtered texts before it counts as an episode —
 *  one bad number is not a pattern. */
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
  /** The verdict the alert hangs on: filtered texts are at least
   *  MIN_FILTERED and at least as many as delivered ones. */
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
    filtering: false,
  };
  const sample: FilteredSample[] = [];
  for (const m of rows) {
    const at = Number(m.created_at);
    if (m.direction !== "outbound" || !(at >= since) || at > now) continue;
    const status = m.status ?? "";
    if (FINAL_OK.has(status)) {
      summary.delivered++;
    } else if (FINAL_BAD.has(status)) {
      if (String(m.error_code ?? "") === FILTERED_ERROR_CODE) {
        summary.filtered++;
        sample.push({ to: m.to_number, at, template: m.template ?? null });
      } else {
        summary.undeliveredOther++;
      }
    } else {
      summary.pending++;
    }
  }
  summary.filteredSample = sample.sort((a, b) => b.at - a.at).slice(0, 12);
  summary.filtering =
    summary.filtered >= MIN_FILTERED && summary.filtered >= summary.delivered;
  return summary;
}

export type DeliveryVerdict = "alert" | "recovered" | "quiet";

/**
 * Alert when filtering is on and no alert is open (or the last one is
 * older than the cooldown); recovered when an alert is open and the
 * window shows a few deliveries and no filtered text; quiet otherwise.
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
  if (state.alertedAt && summary.delivered >= MIN_FILTERED && summary.filtered === 0) {
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
