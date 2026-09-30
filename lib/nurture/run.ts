import { xano } from "@/lib/xano";
import { readAppSettings } from "@/lib/app-settings";
import { sendSms } from "@/lib/sms/send";
import {
  DAILY_GAP_MS,
  NURTURE_TEMPLATE_PREFIX,
  STEP_AUTHOR,
  leadKey,
  planNurture,
  type NurtureInput,
  type NurtureItem,
} from "@/lib/nurture/plan";

/**
 * Loads the snapshot the planner needs. Every read that could turn a
 * failure into a WRONG text is strict: the settings switch, the text
 * log (dedupe), the notes (per-lead pauses) and the tours ("no tour
 * booked" must never be a read error). If any fails, the whole load
 * throws and nothing sends this run. Only the lead lists degrade to []
 * — a missing lead can only mean texts NOT sent.
 */
export async function loadNurtureInput(
  now = Date.now()
): Promise<NurtureInput & { forwardReplies: boolean }> {
  const [settings, messages, notes, inquiries, camps, visits, tascos, tours, calls] =
    await Promise.all([
      readAppSettings(),
      xano.smsMessages.getAllStrict(),
      xano.adminNotes.getAllStrict(),
      xano.inquiries.getAll(),
      xano.summerCamp.getAll().catch(() => []),
      xano.websiteWaivers.getAll().catch(() => []),
      xano.tascoSummerVisits.getAll().catch(() => []),
      xano.tours.getAllStrict(),
      // Answered calls and voicemails count as contact; a failed read
      // must not look like "nobody has called" (strict).
      xano.calls.getAllStrict(),
    ]);
  return {
    now,
    settings: settings.nurture,
    forwardReplies: settings.forwarding.enabled,
    inquiries,
    camps,
    visits,
    tascos,
    tours,
    messages,
    calls,
    notes,
    provider: settings.sms.provider,
  };
}

export interface NurtureRunResult {
  ok: boolean;
  skipped?: "disabled" | "outside_window";
  error?: string;
  due: number;
  sent: number;
  /** Already on the thread when re-checked right before sending. */
  deduped: number;
  /** Consent gate, missing phone, or Twilio not configured. */
  blocked: number;
  failed: number;
  outcomes: Array<{ lead: string; template: string; outcome: string }>;
}

let runInFlight: Promise<NurtureRunResult> | null = null;

/** Send every due follow-up. One run per process at a time — a second
 *  caller joins the running one. */
export function runNurture(): Promise<NurtureRunResult> {
  if (runInFlight) return runInFlight;
  runInFlight = run().finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}

async function run(): Promise<NurtureRunResult> {
  const result: NurtureRunResult = {
    ok: true,
    due: 0,
    sent: 0,
    deduped: 0,
    blocked: 0,
    failed: 0,
    outcomes: [],
  };
  try {
    const input = await loadNurtureInput();
    if (!input.settings.enabled) return { ...result, skipped: "disabled" };
    const plan = planNurture(input);
    if (!plan.inWindow) return { ...result, skipped: "outside_window" };

    const due = plan.items.filter((i) => i.state === "due");
    result.due = due.length;
    for (const item of due) {
      const outcome = await sendItem(item, input.now);
      result.outcomes.push({
        lead: leadKey(item.lead),
        template: item.template,
        outcome,
      });
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "deduped") result.deduped += 1;
      else if (outcome.startsWith("blocked")) result.blocked += 1;
      else result.failed += 1;
    }
    return result;
  } catch (err) {
    console.error("[nurture] run failed:", err);
    return {
      ...result,
      ok: false,
      error: err instanceof Error ? err.message : "Follow-up run failed",
    };
  }
}

async function sendItem(item: NurtureItem, now: number): Promise<string> {
  const contact = { type: item.lead.source, id: item.lead.id } as const;
  // Last look at the thread, fresh: an overlapping run (Vercel can fire
  // a cron twice) may have sent this a moment ago.
  try {
    const thread = await xano.smsMessages.getByContactStrict(
      contact.type,
      contact.id
    );
    const outbound = thread.filter((m) => m.direction === "outbound");
    if (outbound.some((m) => m.template === item.template)) return "deduped";
    if (
      item.step !== "tour_reminder" &&
      outbound.some(
        (m) =>
          (m.template ?? "").startsWith(NURTURE_TEMPLATE_PREFIX) &&
          m.created_at >= now - DAILY_GAP_MS
      )
    ) {
      return "deduped";
    }
  } catch (err) {
    // Can't prove it wasn't just sent — hold it for the next run.
    console.error(`[nurture] thread re-check failed for ${leadKey(item.lead)}:`, err);
    return "failed: thread unreadable";
  }

  // Claimed: the log row is written before the text goes out, so a Xano
  // write outage can't turn into the same text every half hour, and an
  // overlapping run backs off instead of sending twice.
  const res = await sendSms({
    contact,
    body: item.body,
    template: item.template,
    author: { email: "", name: STEP_AUTHOR[item.step] },
    claim: true,
  });
  if (res.deduped) return "deduped";
  if (res.ok) return "sent";
  if (res.skipped) return `blocked: ${res.skipped}`;
  return `failed: ${res.error ?? "unknown"}`;
}
