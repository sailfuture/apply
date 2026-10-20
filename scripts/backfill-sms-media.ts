/**
 * One-time backfill: photos and files that parents texted to the Main
 * Line BEFORE `sms_messages.media` existed (2026-10-20) were logged as
 * the bare placeholder "(sent a photo or file)" and the attachment was
 * dropped. Quo still has them: for every such row this reads the
 * message back from Quo (GET /v1/messages/{id}) and PATCHes the
 * attachments onto the row.
 *
 * Idempotent: a row that already has media, has no Quo id, or whose
 * body isn't the placeholder is left alone, so running it twice
 * changes nothing the second time.
 *
 * Usage (reads XANO_API_BASE_URL and QUO_API_KEY from .env.local):
 *   npx tsx scripts/backfill-sms-media.ts            # dry run — counts only
 *   npx tsx scripts/backfill-sms-media.ts --confirm  # write the PATCHes
 *
 * Prints how many rows were candidates, how many Quo still had media
 * for, how many were filled, and which ids Quo no longer knows.
 */
import * as fs from "fs";
import * as path from "path";
import type { SmsMediaItem, XanoSmsMessage } from "../lib/xano";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "").trim();
  }
}
loadEnv();

const PLACEHOLDER = "(sent a photo or file)";
const confirm = process.argv.includes("--confirm");

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

async function main() {
  const base = (process.env.XANO_API_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("XANO_API_BASE_URL is not set");
  if (!process.env.QUO_API_KEY) throw new Error("QUO_API_KEY is not set");
  // Imported after the env is loaded: lib/quo reads QUO_API_KEY lazily,
  // and lib/quo/ingest pulls in lib/xano, which wants its base url.
  const { getMessage } = await import("../lib/quo");
  const { quoMediaItems } = await import("../lib/quo/ingest");
  const { smsMedia } = await import("../lib/sms/media");

  const res = await request(`${base}/sms_messages`);
  if (!res.ok) throw new Error(`sms_messages read failed: ${res.status}`);
  const rows: XanoSmsMessage[] = await res.json();
  const candidates = rows
    .filter(
      (r) =>
        r.provider === "quo" &&
        !!r.quo_message_id &&
        (r.body ?? "").trim() === PLACEHOLDER &&
        smsMedia(r).length === 0
    )
    .sort((a, b) => a.id - b.id);

  console.log(
    `${rows.length} rows read · ${candidates.length} placeholder rows without media` +
      (confirm ? "" : " (dry run — add --confirm to write)")
  );

  let filled = 0;
  let empty = 0;
  const missing: number[] = [];
  const failed: number[] = [];
  for (const row of candidates) {
    const message = await getMessage(row.quo_message_id as string).catch((err) => {
      console.error(`  row ${row.id}: Quo read failed —`, err instanceof Error ? err.message : err);
      return undefined;
    });
    if (message === undefined) {
      failed.push(row.id);
      continue;
    }
    if (message === null) {
      missing.push(row.id);
      continue;
    }
    const media: SmsMediaItem[] = quoMediaItems(message.media);
    if (media.length === 0) {
      empty += 1;
      continue;
    }
    if (!confirm) {
      filled += 1;
      console.log(`  row ${row.id}: ${media.length} item(s) — ${media.map((m) => m.type).join(", ")}`);
      continue;
    }
    const patch = await request(`${base}/sms_messages/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media }),
    });
    if (!patch.ok) {
      console.error(`  row ${row.id}: PATCH failed ${patch.status}`);
      failed.push(row.id);
      continue;
    }
    const saved: XanoSmsMessage = await patch.json();
    if (smsMedia(saved).length !== media.length) {
      console.error(`  row ${row.id}: PATCH did not store the media array`);
      failed.push(row.id);
      continue;
    }
    filled += 1;
    console.log(`  row ${row.id}: ${media.length} item(s) — ${media.map((m) => m.type).join(", ")}`);
  }

  console.log("");
  console.log(`${confirm ? "Filled" : "Would fill"}: ${filled}`);
  console.log(`Quo has the message but no media: ${empty}`);
  console.log(`Quo no longer has the message: ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}`);
  console.log(`Failed: ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
