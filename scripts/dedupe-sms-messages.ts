/**
 * One-time cleanup for duplicated `sms_messages` rows — two rows
 * carrying the same Twilio SID, which is one text logged twice.
 *
 * Cause: on 2026-09-11 a Twilio sync sweep ran without knowing any of
 * the SIDs already in the log, so it re-imported its whole 30-day
 * window as `external` ("Sent outside Apply") copies of rows the app
 * had written itself. The sync has since been made fail-closed (see
 * the dedupe guards in `lib/sms/sync.ts`) — deploy that BEFORE
 * running this, or the next bad read puts the copies back.
 *
 * Per duplicated SID this:
 *   - KEEPS the app's original row: the one whose template is not
 *     `external`. When no row qualifies, or more than one does (two
 *     imports of the same outside text; an inbound text logged by the
 *     webhook and again by the sweep), the lowest id — the first one
 *     written.
 *   - COPIES onto the kept row what it is missing and a duplicate
 *     has: `from_number` (the app logs it blank — Twilio picks the
 *     sender after accepting the message), `segments` (logged as 0 for
 *     the same reason), a settled `status`, `error_code`, and the real
 *     send time.
 *   - DELETES the other row.
 *
 * The kept row's contact, template, author, student and year are
 * never touched — they are why it is the one worth keeping.
 *
 * Usage:
 *   1. `XANO_API_BASE_URL` must be set in `.env.local` (read directly
 *      here via the same lightweight parser the other scripts use).
 *   2. Dry-run first — this is the default, no flag needed:
 *      `npx tsx scripts/dedupe-sms-messages.ts`
 *   3. Then apply exactly the plan that dry run printed:
 *      `npx tsx scripts/dedupe-sms-messages.ts --confirm --plan <fingerprint>`
 *
 * Options:
 *   --exact-times  Copy Twilio's send time onto every kept row that
 *                  differs from it at all. Off by default: the app
 *                  logs a send a second or two after Twilio accepts
 *                  it, and only a gap over a minute is treated as a
 *                  wrong timestamp (same tolerance as
 *                  `lib/sms/repair-timestamps.ts`).
 *
 * Safety:
 *   - Dry-run unless `--confirm`. Prints counts and row ids only —
 *     never a phone number or a word of message text.
 *   - `--confirm` needs the fingerprint the dry run printed. If the
 *     table changed in between and the plan is no longer the one you
 *     looked at, it refuses and you dry-run again.
 *   - A group is only touched when its rows agree on direction,
 *     recipient and text. Anything else is held back and listed for a
 *     human.
 *   - Before the first write, every row about to be changed or
 *     deleted is saved in full to `scripts/.backups/` (gitignored — it
 *     holds family phone numbers and message text).
 *   - Merges first, deletes second, and nothing is deleted unless
 *     every merge was confirmed by the row Xano sent back. Xano's
 *     PATCH drops empty inputs, so the merge only ever sends real
 *     values — and checks that they stuck.
 *   - Idempotent: a second run finds nothing to do.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { XanoSmsMessage } from "../lib/xano";

function loadEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "").trim();
  }
}

/** Statuses Twilio won't change again — same set the sync uses. */
const SETTLED = new Set(["delivered", "undelivered", "failed", "received"]);

/** How far a kept row's timestamp may sit from Twilio's before it
 *  counts as wrong — same tolerance as the timestamp repair. */
const TIME_TOLERANCE_MS = 60_000;

const MERGE_FIELDS = [
  "from_number",
  "segments",
  "status",
  "error_code",
  "created_at",
] as const;
type MergeField = (typeof MERGE_FIELDS)[number];
type Merge = Partial<Record<MergeField, string | number>>;

interface GroupPlan {
  keep: XanoSmsMessage;
  remove: XanoSmsMessage[];
  merge: Merge;
  kind: string;
  /** The kept row sits on a different contact's thread than a
   *  duplicate — after the delete, that other thread loses its copy. */
  contactDiffers: boolean;
  /** Kept row is off Twilio's send time, but inside the tolerance. */
  timeWithinTolerance: boolean;
}

interface HeldBack {
  ids: number[];
  reason: string;
}

/** Bare 10-digit form — same rule as `normPhone` in
 *  `lib/sms/contacts.ts`. */
function normPhone(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * Twilio's Smart Encoding rewrites punctuation that would push a text
 * into UCS-2 (an em dash becomes a hyphen, curly quotes go straight),
 * so the copy Twilio hands back can differ from the body the app
 * logged. Fold those before comparing two rows' text.
 */
function foldText(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　﻿]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function kindOf(row: XanoSmsMessage): string {
  if (row.direction === "inbound") return "inbound";
  return row.template === "external" ? "external copy" : "app-sent";
}

function contactOf(row: XanoSmsMessage): string {
  return [
    row.registration_families_id,
    row.registration_inquiry_id,
    row.registration_summer_camp_id,
    row.website_liability_waiver_id,
    row.tasco_summer_visit_id,
  ]
    .map((v) => Number(v) || 0)
    .join("/");
}

/** Why this group can't be merged automatically, or null if it can. */
function disagreement(rows: XanoSmsMessage[]): string | null {
  if (new Set(rows.map((r) => r.direction)).size > 1) {
    return "rows disagree on direction";
  }
  if (new Set(rows.map((r) => normPhone(r.to_number))).size > 1) {
    return "rows disagree on the recipient number";
  }
  const senders = new Set(
    rows.map((r) => normPhone(r.from_number)).filter(Boolean)
  );
  if (senders.size > 1) return "rows disagree on the sender number";
  if (new Set(rows.map((r) => foldText(r.body))).size > 1) {
    return "rows disagree on the message text";
  }
  return null;
}

function planGroup(rows: XanoSmsMessage[], exactTimes: boolean): GroupPlan {
  const byId = [...rows].sort((a, b) => a.id - b.id);
  const originals = byId.filter((r) => r.template !== "external");
  const keep = originals[0] ?? byId[0];
  const remove = byId.filter((r) => r.id !== keep.id);

  const merge: Merge = {};
  let timeWithinTolerance = false;
  for (const donor of remove) {
    // A Messaging Service SID ("MG…") is not a phone number — the
    // app never stores it as one, so don't copy one in either.
    const from = (donor.from_number ?? "").trim();
    if (
      !(keep.from_number ?? "").trim() &&
      merge.from_number === undefined &&
      from &&
      !from.startsWith("MG")
    ) {
      merge.from_number = from;
    }
    if (
      !(Number(keep.segments) > 0) &&
      merge.segments === undefined &&
      Number(donor.segments) > 0
    ) {
      merge.segments = Number(donor.segments);
    }
    if (
      !SETTLED.has(keep.status) &&
      merge.status === undefined &&
      SETTLED.has(donor.status)
    ) {
      merge.status = donor.status;
    }
    if (
      !(keep.error_code ?? "").trim() &&
      merge.error_code === undefined &&
      (donor.error_code ?? "").trim()
    ) {
      merge.error_code = (donor.error_code ?? "").trim();
    }
    // Only an imported copy carries Twilio's own send time; any other
    // row's `created_at` is just the moment it was written.
    if (donor.template === "external" && merge.created_at === undefined) {
      const gap = Math.abs(keep.created_at - donor.created_at);
      if (gap > (exactTimes ? 0 : TIME_TOLERANCE_MS)) {
        merge.created_at = donor.created_at;
      } else if (gap > 0) {
        timeWithinTolerance = true;
      }
    }
  }

  return {
    keep,
    remove,
    merge,
    kind: [keep, ...remove].map(kindOf).join(" + "),
    contactDiffers: remove.some((r) => contactOf(r) !== contactOf(keep)),
    timeWithinTolerance,
  };
}

function buildPlan(
  rows: XanoSmsMessage[],
  exactTimes: boolean
): { groups: GroupPlan[]; heldBack: HeldBack[] } {
  const bySid = new Map<string, XanoSmsMessage[]>();
  for (const row of rows) {
    // Failed sends have no SID (stored as ""): nothing to match on.
    const sid = (row.twilio_message_sid ?? "").trim();
    if (!sid) continue;
    const list = bySid.get(sid);
    if (list) list.push(row);
    else bySid.set(sid, [row]);
  }

  const groups: GroupPlan[] = [];
  const heldBack: HeldBack[] = [];
  for (const list of bySid.values()) {
    if (list.length < 2) continue;
    const reason = disagreement(list);
    if (reason) {
      heldBack.push({ ids: list.map((r) => r.id).sort((a, b) => a - b), reason });
      continue;
    }
    groups.push(planGroup(list, exactTimes));
  }
  groups.sort((a, b) => a.keep.id - b.keep.id);
  heldBack.sort((a, b) => a.ids[0] - b.ids[0]);
  return { groups, heldBack };
}

/** Short hash of exactly what would be written — the thing a human
 *  approves. Any change to a kept id, a deleted id or a merged value
 *  changes it. */
function fingerprint(groups: GroupPlan[]): string {
  const canonical = groups.map((g) => ({
    keep: g.keep.id,
    remove: g.remove.map((r) => r.id),
    merge: MERGE_FIELDS.filter((f) => g.merge[f] !== undefined).map((f) => [
      f,
      g.merge[f],
    ]),
  }));
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 12);
}

/** `[3,4,5,9]` → `3–5, 9`. */
function ranges(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? `${start}` : `${start}–${sorted[i]}`);
  }
  return out.join(", ");
}

function printIds(ids: number[], perLine = 12): void {
  const sorted = [...ids].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += perLine) {
    console.log(
      "  " +
        sorted
          .slice(i, i + perLine)
          .map((id) => String(id).padStart(5))
          .join(" ")
    );
  }
}

/** One Xano call with the usual retry — 429 / 5xx / network only. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  let thrown: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const res = await fetch(url, { cache: "no-store", ...init });
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      last = res;
    } catch (err) {
      thrown = err;
    }
  }
  if (last) return last;
  throw thrown instanceof Error ? thrown : new Error(String(thrown));
}

async function readAll(base: string): Promise<XanoSmsMessage[]> {
  const res = await request(`${base}/sms_messages`);
  if (!res.ok) {
    throw new Error(`GET /sms_messages → ${res.status}`);
  }
  const rows: unknown = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    // An empty or non-list answer is a failed read, not an empty log.
    throw new Error("GET /sms_messages did not return a list of rows");
  }
  return rows as XanoSmsMessage[];
}

async function main(): Promise<void> {
  loadEnv();

  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const confirm = args.has("--confirm");
  const exactTimes = args.has("--exact-times");
  const planAt = argv.indexOf("--plan");
  const approved = planAt >= 0 ? (argv[planAt + 1] ?? "") : "";

  if (confirm && args.has("--dry-run")) {
    console.error("Pass one of --dry-run or --confirm, not both.");
    process.exit(1);
  }

  const base = process.env.XANO_API_BASE_URL;
  if (!base) {
    console.error("XANO_API_BASE_URL is not set (check .env.local).");
    process.exit(1);
  }

  console.log(
    confirm
      ? "LIVE RUN — rows will be changed and deleted.\n"
      : "DRY RUN — nothing will be written.\n"
  );

  const rows = await readAll(base);
  const { groups, heldBack } = buildPlan(rows, exactTimes);
  const plan = fingerprint(groups);

  const allIds = rows.map((r) => r.id);
  const withSid = rows.filter((r) => (r.twilio_message_sid ?? "").trim());
  const distinct = new Set(withSid.map((r) => r.twilio_message_sid)).size;
  const removeIds = groups.flatMap((g) => g.remove.map((r) => r.id));

  console.log(
    `Loaded ${rows.length} rows (ids ${Math.min(...allIds)}–${Math.max(...allIds)}): ` +
      `${withSid.length} carry a Twilio SID, ${distinct} distinct.`
  );
  console.log(
    `Duplicated SIDs: ${groups.length + heldBack.length} ` +
      `(${groups.length} to merge, ${heldBack.length} held back).\n`
  );

  const byKind = new Map<string, number>();
  for (const g of groups) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
  console.log("By kind (kept row + duplicate):");
  for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${kind}`);
  }

  if (heldBack.length) {
    console.log("\nHeld back — NOT touched, review by hand:");
    for (const h of heldBack) {
      console.log(`  rows ${h.ids.join(", ")}: ${h.reason}`);
    }
  }

  console.log("\nCopied onto kept rows (rows needing each field):");
  for (const field of MERGE_FIELDS) {
    const ids = groups
      .filter((g) => g.merge[field] !== undefined)
      .map((g) => g.keep.id);
    console.log(
      `  ${field.padEnd(12)} ${String(ids.length).padStart(4)}` +
        (ids.length ? `   rows ${ranges(ids)}` : "")
    );
  }
  const nearTimes = groups.filter((g) => g.timeWithinTolerance).length;
  if (nearTimes) {
    console.log(
      `  (${nearTimes} kept rows are within ${TIME_TOLERANCE_MS / 1000}s of ` +
        "Twilio's send time and keep their own — --exact-times copies those too.)"
    );
  }

  const moved = groups.filter((g) => g.contactDiffers);
  if (moved.length) {
    console.log(
      "\nKept row and duplicate sit on DIFFERENT contacts' threads " +
        "(same phone, two records) — the duplicate's thread loses its copy:"
    );
    for (const g of moved) {
      console.log(
        `  keep ${g.keep.id}, delete ${g.remove.map((r) => r.id).join(", ")}`
      );
    }
  }

  console.log(`\nRows kept (${groups.length}): ${ranges(groups.map((g) => g.keep.id))}`);
  console.log(`\nRows to DELETE (${removeIds.length}): ${ranges(removeIds)}`);
  printIds(removeIds);
  console.log(`\nRows after cleanup: ${rows.length - removeIds.length}`);

  if (!groups.length) {
    console.log("\nNothing to do.");
    return;
  }

  console.log(`\nPlan fingerprint: ${plan}`);

  if (!confirm) {
    console.log(
      "\nDry run — nothing was written. To apply exactly this plan:\n" +
        `  npx tsx scripts/dedupe-sms-messages.ts --confirm --plan ${plan}` +
        (exactTimes ? " --exact-times" : "")
    );
    return;
  }

  if (approved !== plan) {
    console.error(
      approved
        ? `\nThe plan is now ${plan}, not ${approved} — the table changed ` +
            "since that dry run. Nothing was written; review the plan above " +
            "and confirm it instead."
        : "\n--confirm needs --plan <fingerprint> from a dry run. Nothing was written."
    );
    process.exit(1);
  }

  // Full copies of everything about to change, before the first
  // write — a deleted row can be re-created from this file.
  const backupDir = path.join(process.cwd(), "scripts", ".backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `sms-dedupe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        plan,
        savedAt: new Date().toISOString(),
        kept: groups.map((g) => g.keep),
        deleted: groups.flatMap((g) => g.remove),
      },
      null,
      2
    )
  );
  console.log(`\nBackup written: ${backupPath}`);

  // Sequential throughout: a few hundred rows is small, and a serial
  // loop keeps the failure report readable if Xano starts rejecting
  // mid-run.
  console.log("\nMerging…");
  let merged = 0;
  for (const g of groups) {
    if (!Object.keys(g.merge).length) continue;
    const res = await request(`${base}/sms_messages/${g.keep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(g.merge),
    });
    if (!res.ok) {
      console.error(
        `  ✗ row ${g.keep.id}: ${res.status}. Stopped — ${merged} rows ` +
          "merged, nothing deleted. Dry-run again to continue."
      );
      process.exit(1);
    }
    const echoed = (await res.json()) as XanoSmsMessage;
    const dropped = MERGE_FIELDS.filter(
      (f) => g.merge[f] !== undefined && echoed[f] !== g.merge[f]
    );
    if (dropped.length) {
      console.error(
        `  ✗ row ${g.keep.id}: Xano ignored ${dropped.join(", ")} on PATCH ` +
          "/sms_messages/{id} — expose those inputs on that endpoint. " +
          `Stopped — ${merged} rows merged, nothing deleted.`
      );
      process.exit(1);
    }
    merged++;
  }
  console.log(`  ✓ ${merged} kept rows updated and verified.`);

  console.log("\nDeleting…");
  let deleted = 0;
  const failed: string[] = [];
  for (const id of removeIds) {
    const res = await request(`${base}/sms_messages/${id}`, {
      method: "DELETE",
    });
    // 404 = a retried delete whose first attempt had already landed.
    if (res.ok || res.status === 404) {
      deleted++;
    } else {
      failed.push(`row ${id}: ${res.status}`);
      console.error(`  ✗ row ${id}: ${res.status}`);
    }
  }
  console.log(`  ✓ ${deleted}/${removeIds.length} rows deleted.`);

  const after = await readAll(base);
  const left = buildPlan(after, exactTimes);
  console.log(
    `\nTable now has ${after.length} rows; duplicated SIDs remaining: ` +
      `${left.groups.length + left.heldBack.length}` +
      (left.heldBack.length ? ` (${left.heldBack.length} held back)` : "") +
      "."
  );
  if (failed.length) {
    console.error(
      `${failed.length} deletes failed — dry-run again and confirm the new plan to retry.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
