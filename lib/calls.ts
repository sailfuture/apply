import type { XanoCall } from "@/lib/xano";

/**
 * Shared wording for phone calls on the Main Line — the activity log,
 * the lead timeline and the dashboard feed all describe a call the
 * same way.
 */

/** "Incoming call" / "Outgoing call" / "Missed call" / "Voicemail". */
export function callLabel(
  call: Pick<XanoCall, "direction" | "status" | "has_voicemail"> & { answered_at?: number }
): string {
  if (call.has_voicemail || call.status === "voicemail") return "Voicemail";
  if (call.direction === "outgoing") {
    return call.status === "no-answer" || call.status === "busy" || call.status === "canceled"
      ? "Outgoing call (no answer)"
      : "Outgoing call";
  }
  // An incoming call nobody picked up is missed whatever Quo called it
  // (a hang-up in the phone menu comes through as "completed").
  if (
    call.status === "missed" ||
    call.status === "no-answer" ||
    call.status === "abandoned" ||
    (call.answered_at !== undefined && !call.answered_at)
  ) {
    return "Missed call";
  }
  return "Incoming call";
}

/** "4 min" / "45 sec" / "" for zero. */
export function callDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (!s) return "";
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  return `${m} min`;
}

export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** One-paragraph gist for lists: the summary bullets, else the
 *  voicemail transcript, else nothing. */
export function callGist(call: Pick<XanoCall, "summary" | "voicemail_transcript">): string {
  const bullets = stringList(call.summary);
  if (bullets.length) return bullets.join(" ");
  return (call.voicemail_transcript ?? "").trim();
}

/** A call that is waiting on us: someone rang the Main Line and nobody
 *  picked up, or they left a voicemail. An answered call, or one we
 *  placed, is handled — same standing as an outbound text. */
export function callNeedsReply(
  call: Pick<XanoCall, "direction" | "status" | "has_voicemail"> & { answered_at?: number }
): boolean {
  if (call.direction === "outgoing") return false;
  const label = callLabel(call);
  return label === "Missed call" || label === "Voicemail";
}

/** One line for lists and notifications: "Missed call", "Incoming
 *  call · 4 min", "Voicemail: <what they said>" — with Quo's summary
 *  gist after a dot when there is one. */
export function callPreview(call: XanoCall): string {
  const label = callLabel(call);
  const gist = callGist(call);
  if (label === "Voicemail") return gist ? `Voicemail: ${gist}` : "Voicemail";
  const duration = callDuration(call.duration_seconds);
  const head = duration ? `${label} · ${duration}` : label;
  return gist ? `${head} · ${gist}` : head;
}

export function callHasAudio(call: Pick<XanoCall, "recording_id" | "has_voicemail">): boolean {
  return Boolean(call.recording_id) || Boolean(call.has_voicemail);
}
