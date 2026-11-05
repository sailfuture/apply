/**
 * One-off resync of every family's "(Student, Student)" name suffix.
 *
 * The app now keeps the suffix in step with the roster as students are
 * added, archived or renamed (`lib/family-name-sync.ts`). Families
 * whose roster changed before that existed still carry the old suffix,
 * e.g. "Adams Family (Jorden)" after Matthew joined mid-year. This
 * rewrites those once; it never touches a name that already matches.
 *
 * Usage:
 *   `XANO_API_BASE_URL` and `XANO_API_KEY` must be set (in `.env.local`
 *   or the shell; the registration API group rejects unkeyed reads).
 *
 *   Dry-run first, prints every rename it would make:
 *     npx tsx scripts/sync-family-names.ts --dry-run
 *   Then write:
 *     npx tsx scripts/sync-family-names.ts --confirm
 *
 * Options:
 *   --family <id>   Only that family.
 *
 * Safety: dry-run unless `--confirm`; never both. Archived families are
 * skipped. A family whose name is blank is reported and left alone.
 */

import * as fs from "fs";
import * as path from "path";
import type { XanoFamily, XanoStudent } from "../lib/xano";
import { xanoFetch } from "../lib/xano-fetch";
import { familyNameWithStudents } from "../lib/family-name";

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

async function getJson<T>(url: string): Promise<T> {
  const res = await xanoFetch(url, { cache: "no-store" }, { fresh: true });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const dryRun = args.includes("--dry-run") || !confirm;
  if (confirm && args.includes("--dry-run")) {
    console.error("Pass one of --dry-run or --confirm, not both.");
    process.exit(1);
  }
  const onlyIdx = args.indexOf("--family");
  const onlyFamily = onlyIdx >= 0 ? Number(args[onlyIdx + 1]) : null;

  const base = process.env.XANO_API_BASE_URL;
  if (!base) {
    console.error("XANO_API_BASE_URL is not set (check .env.local).");
    process.exit(1);
  }
  if (!process.env.XANO_API_KEY) {
    console.error("XANO_API_KEY is not set; the registration group needs it.");
    process.exit(1);
  }
  console.log(dryRun ? "DRY RUN: nothing will be written.\n" : "WRITING.\n");

  const [families, students] = await Promise.all([
    getJson<XanoFamily[]>(`${base}/registration_families`),
    getJson<XanoStudent[]>(`${base}/registration_students`),
  ]);

  const rosterByFamily = new Map<number, XanoStudent[]>();
  for (const s of students) {
    if (s.isArchived) continue;
    const fid = Number(s.registration_families_id);
    if (!Number.isFinite(fid) || fid <= 0) continue;
    const list = rosterByFamily.get(fid) ?? [];
    list.push(s);
    rosterByFamily.set(fid, list);
  }

  let changed = 0;
  let blank = 0;
  for (const fam of families) {
    if (onlyFamily !== null && fam.id !== onlyFamily) continue;
    if ((fam as { isArchived?: boolean }).isArchived) continue;
    const current = (fam.family_name ?? "").trim();
    if (!current) {
      blank++;
      console.log(`#${fam.id}: blank name, skipped`);
      continue;
    }
    const roster = (rosterByFamily.get(fam.id) ?? []).sort(
      (a, b) => a.id - b.id
    );
    const next = familyNameWithStudents(
      current,
      roster.map((s) => s.first_name)
    );
    if (next === current) continue;
    changed++;
    console.log(`#${fam.id}: "${current}" -> "${next}"`);
    if (dryRun) continue;
    const res = await xanoFetch(`${base}/registration_families/${fam.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_name: next }),
    });
    if (!res.ok) {
      console.error(`  PATCH failed: ${res.status} ${await res.text()}`);
    }
  }
  const noun = changed === 1 ? "family" : "families";
  console.log(
    `\n${changed} ${noun} ${dryRun ? "would change" : "updated"}, ${blank} blank.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
