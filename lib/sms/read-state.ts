import "server-only";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import type { ReadStateMap } from "@/lib/sms/unread";

/**
 * Per-admin read state for the SMS inbox, stored on the admin's CLERK
 * USER rather than in their browser.
 *
 * Why Clerk and not Xano: this is state about a person, not about the
 * school's records — it needs no reporting, no joins and no history,
 * and the app already keeps per-user server state here (the parent
 * side's `registration_families_id`). That means no new table, no
 * endpoint wiring, and it works the moment it deploys.
 *
 * Two maps, both `${contactType}:${contactId}` → unix ms:
 *   - `viewed`    — newest message this admin has looked at on a
 *                   thread. Grays the inbox dot and clears the badge.
 *   - `announced` — newest message already raised as a desktop
 *                   notification, so a second device doesn't re-announce
 *                   texts the first one already popped.
 *
 * Because both live on the account, reading a thread on a laptop
 * clears the badge on a phone — which the old per-browser
 * `localStorage` map could never do.
 */

/** Namespace inside `privateMetadata`. */
const KEY = "sms_read_state";

/** Clerk caps metadata at a few KB, so both maps are bounded. Entries
 *  are dropped oldest-first once either limit is hit.
 *
 *  `viewed` is kept generous — it drives the inbox's dots for every
 *  needs-reply thread, however old. `announced` only has to outlive the
 *  notifier's own 24h window, so it stays small. */
const LIMITS = {
  viewed: { maxEntries: 120, maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
  announced: { maxEntries: 40, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
} as const;

export type ReadStateField = keyof typeof LIMITS;

export interface SmsReadState {
  viewed: ReadStateMap;
  announced: ReadStateMap;
}

export interface ReadStateEntry {
  key: string;
  at: number;
}

const EMPTY_STATE: SmsReadState = { viewed: {}, announced: {} };

/** Defensive parse — metadata is free-form JSON, so anything that
 *  isn't a `string → positive number` map is discarded rather than
 *  trusted into the badge math. */
function toMap(value: unknown): ReadStateMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ReadStateMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

function parseState(metadata: unknown): SmsReadState {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.[KEY];
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const obj = raw as Record<string, unknown>;
  return { viewed: toMap(obj.viewed), announced: toMap(obj.announced) };
}

/**
 * The signed-in admin's read state. `currentUser()` is memoized per
 * request, so routes that also need the user pay for one call, not two.
 * Never throws — a Clerk hiccup degrades to "nothing read yet", which
 * over-counts the badge rather than hiding a parent's text.
 */
export async function getSmsReadState(): Promise<SmsReadState> {
  try {
    const user = await currentUser();
    return user ? parseState(user.privateMetadata) : EMPTY_STATE;
  } catch (err) {
    console.error("[sms/read-state] failed to load:", err);
    return EMPTY_STATE;
  }
}

/**
 * Fold new stamps into one of the maps and persist.
 *
 * Only RAISES a key's timestamp, so a newer inbound text re-lights a
 * thread the admin marked viewed an hour ago, and two devices racing
 * can't move the watermark backwards.
 *
 * Writes the COMPLETE state, not a delta, with pruned keys sent as
 * `null`. Clerk merges metadata rather than replacing it, so a delta
 * alone could never shrink a map; sending the whole thing plus
 * explicit deletes lands the same result whether the merge is deep or
 * shallow, which is worth a few KB on a write this rare.
 *
 * Returns the merged map so the caller can hand the client the truth
 * instead of making it guess.
 */
export async function mergeSmsReadState(
  userId: string,
  field: ReadStateField,
  entries: ReadStateEntry[],
  current?: SmsReadState
): Promise<SmsReadState> {
  const state = current ?? (await getSmsReadState());
  const before = state[field];
  const merged: ReadStateMap = { ...before };
  /** Keys pruning removed, as Clerk's `null` = delete. */
  const dropped: Record<string, null> = {};
  let changed = false;

  for (const entry of entries) {
    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
    const at = Number(entry?.at);
    if (!key || !Number.isFinite(at) || at <= 0) continue;
    if (at <= (merged[key] ?? 0)) continue;
    merged[key] = at;
    changed = true;
  }

  // Prune AFTER merging so a brand-new stamp is never dropped by an
  // older one that happened to be sorted ahead of it.
  const { maxEntries, maxAgeMs } = LIMITS[field];
  const floor = Date.now() - maxAgeMs;
  const kept = Object.entries(merged)
    .filter(([, at]) => at >= floor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntries);
  const keptKeys = new Set(kept.map(([k]) => k));
  for (const key of Object.keys(merged)) {
    if (keptKeys.has(key)) continue;
    delete merged[key];
    dropped[key] = null;
    changed = true;
  }

  const next: SmsReadState = { ...state, [field]: merged };
  if (!changed) return next;

  try {
    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, {
      privateMetadata: {
        [KEY]: {
          ...next,
          // Merged map first, then the deletes — `dropped` carries a
          // `null` for every key pruning removed.
          [field]: { ...merged, ...dropped },
        },
      },
    });
  } catch (err) {
    // Best-effort: the caller still gets the merged map, so the badge
    // clears for this session and the next successful write catches up.
    console.error("[sms/read-state] failed to persist:", err);
  }
  return next;
}
