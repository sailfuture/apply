import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  getSmsReadState,
  mergeSmsReadState,
  type ReadStateEntry,
  type ReadStateField,
} from "@/lib/sms/read-state";
import type { ReadStateMap } from "@/lib/sms/unread";

export interface ReadStateRequest {
  /** Threads the admin just opened — `${contactType}:${contactId}` →
   *  the newest message timestamp they saw. */
  viewed?: ReadStateEntry[];
  /** Threads a desktop notification just fired for. */
  announced?: ReadStateEntry[];
}

export interface ReadStateResponse {
  viewed: ReadStateMap;
  announced: ReadStateMap;
}

const FIELDS: ReadStateField[] = ["viewed", "announced"];
/** One request can't stamp more than this. `Mark all as read` on a
 *  large backlog is the realistic ceiling; anything past it is a bug
 *  or a bored script. */
const MAX_ENTRIES = 500;

function parseEntries(value: unknown): ReadStateEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ReadStateEntry[] = [];
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== "object") continue;
    const { key, at } = raw as { key?: unknown; at?: unknown };
    const n = Number(at);
    if (typeof key !== "string" || !key.trim()) continue;
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ key: key.trim(), at: n });
  }
  return out;
}

/**
 * Record what this admin has seen in the SMS inbox.
 *
 * Stamps land on the admin's Clerk user, so they follow the account
 * across laptop, phone and any browser they sign in from — the whole
 * point of this endpoint. Stamps only ever move FORWARD, so a newer
 * inbound text re-lights a thread and two devices can't fight.
 *
 * Responds with the merged maps so the caller can replace its
 * optimistic copy with the server's truth.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await requireAdmin();
    const body: unknown = await req.json().catch(() => ({}));
    const patch = (body ?? {}) as ReadStateRequest;

    // One read for both merges — `mergeSmsReadState` would otherwise
    // re-fetch the Clerk user for the second field.
    let state = await getSmsReadState();
    for (const field of FIELDS) {
      const entries = parseEntries(patch[field]);
      if (entries.length === 0) continue;
      state = await mergeSmsReadState(userId, field, entries, state);
    }

    return NextResponse.json({
      viewed: state.viewed,
      announced: state.announced,
    } satisfies ReadStateResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}
