/**
 * One-off backfill for the laptop-assignment bridge columns.
 *
 * The staff RFID check-in system creates `laptop_assignments` rows
 * carrying only its own ops `students_id` UUID; this app's columns
 * (`enrolled_students_id` / `enrolled_families_id`) stay 0. Anything
 * that reads those columns — the admin Laptops page, the parent
 * Store list, the one-device-per-student guard — therefore can't see
 * who holds most of the fleet.
 *
 * The API routes now resolve the UUID at request time, so the app is
 * already correct without this script. Running it writes those
 * resolutions down, which:
 *   - lets other consumers (and Xano itself) query by student/family,
 *   - keeps the pages right if the ops roster is ever unreachable,
 *   - shrinks each request's work to a plain map lookup.
 *
 * Matching is `lib/laptop-links.ts` — toddle id, then school email,
 * then an unambiguous first+last name. Rows whose holder never went
 * through registration stay unlinked; that's the correct outcome,
 * not a failure.
 *
 * Usage:
 *   1. `XANO_API_BASE_URL` must be set in `.env.local` (read directly
 *      here via the same lightweight parser the other scripts use).
 *   2. Dry-run first — prints every row it would touch:
 *      `npx tsx scripts/backfill-laptop-links.ts --dry-run`
 *   3. Then write:
 *      `npx tsx scripts/backfill-laptop-links.ts --confirm`
 *
 * Options:
 *   --open-only   Only rows with no `returned_date`. Use this to fix
 *                 what's visibly wrong today and leave history alone.
 *   --names       Also write matches made on name alone. Off by
 *                 default: name matching is the one rule that can be
 *                 wrong, so those are reported for review and skipped
 *                 unless you opt in.
 *
 * Safety:
 *   - Dry-run unless `--confirm`; never both.
 *   - Idempotent: rows that already carry the right ids are skipped,
 *     so re-running costs nothing and fixes only what drifted.
 *   - Never clears a link. A row whose UUID no longer resolves is
 *     left exactly as it is.
 *   - Refuses to overwrite an existing link that disagrees with the
 *     resolver — those are printed as conflicts for a human to judge,
 *     since a hand-made link should beat a derived one.
 */

import * as fs from "fs";
import * as path from "path";
import {
  buildLaptopLinkResolver,
  type LaptopLinkMethod,
} from "../lib/laptop-links";
import type {
  XanoLaptop,
  XanoLaptopAssignment,
  XanoOpsStudent,
  XanoStudent,
} from "../lib/xano";

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
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  loadEnv();

  const args = new Set(process.argv.slice(2));
  const confirm = args.has("--confirm");
  const dryRun = args.has("--dry-run") || !confirm;
  const openOnly = args.has("--open-only");
  const allowNames = args.has("--names");

  if (confirm && args.has("--dry-run")) {
    console.error("Pass one of --dry-run or --confirm, not both.");
    process.exit(1);
  }

  const base = process.env.XANO_API_BASE_URL;
  if (!base) {
    console.error("XANO_API_BASE_URL is not set (check .env.local).");
    process.exit(1);
  }
  const host = base.replace(/\/api:[^/]+\/?$/, "");
  const opsBase = `${host}/api:jzQ2liPL`;
  const toddleBase = `${host}/api:fJsHVIeC`;

  console.log(dryRun ? "DRY RUN — nothing will be written.\n" : "WRITING.\n");

  const [assignments, devices, students, opsStudents] = await Promise.all([
    getJson<XanoLaptopAssignment[]>(`${opsBase}/laptop_assignments`),
    getJson<XanoLaptop[]>(`${opsBase}/laptops`),
    getJson<XanoStudent[]>(`${base}/registration_students`),
    getJson<XanoOpsStudent[]>(`${toddleBase}/students`),
  ]);

  console.log(
    `Loaded ${assignments.length} assignments, ${devices.length} devices, ` +
      `${students.length} enrolled students, ${opsStudents.length} ops students.`
  );

  const links = buildLaptopLinkResolver(opsStudents, students);
  console.log(
    `Index: ${links.stats.byToddle} toddle ids, ${links.stats.byEmail} school ` +
      `emails, ${links.stats.byName} names.\n`
  );

  const assetOf = new Map(
    devices.map((d) => [d.id, (d.asset_number ?? "").trim() || `#${d.id}`])
  );

  const rows = assignments.filter((a) => (openOnly ? !a.returned_date : true));

  const toWrite: {
    row: XanoLaptopAssignment;
    students_id: number;
    families_id: number;
    method: LaptopLinkMethod;
  }[] = [];
  const heldBack: typeof toWrite = [];
  const conflicts: string[] = [];
  let alreadyLinked = 0;
  let unresolved = 0;

  for (const row of rows) {
    const link = links.resolve(row.students_id);
    const stamped = Number(row.enrolled_students_id) || 0;

    if (!link) {
      if (!stamped) unresolved++;
      continue;
    }
    if (stamped === link.enrolled_students_id) {
      // Already right — but the family id may still be stale (a
      // student moved family), so re-check that half too.
      if (Number(row.enrolled_families_id) === link.enrolled_families_id) {
        alreadyLinked++;
        continue;
      }
    } else if (stamped) {
      conflicts.push(
        `  row ${row.id} (${assetOf.get(Number(row.laptops_id)) ?? "?"}): ` +
          `linked to student ${stamped}, but its ops UUID resolves to ` +
          `${link.enrolled_students_id} (${link.student.first_name} ` +
          `${link.student.last_name}) by ${link.matchedBy} — left alone.`
      );
      continue;
    }

    const entry = {
      row,
      students_id: link.enrolled_students_id,
      families_id: link.enrolled_families_id,
      method: link.matchedBy,
    };
    if (link.matchedBy === "name" && !allowNames) heldBack.push(entry);
    else toWrite.push(entry);
  }

  const byMethod = (list: typeof toWrite) =>
    list.reduce<Record<string, number>>((acc, e) => {
      acc[e.method] = (acc[e.method] ?? 0) + 1;
      return acc;
    }, {});

  console.log(
    `Scanned ${rows.length} rows${openOnly ? " (open only)" : ""}: ` +
      `${alreadyLinked} already correct, ${toWrite.length} to link, ` +
      `${heldBack.length} name-only held back, ${conflicts.length} conflicts, ` +
      `${unresolved} unresolvable.`
  );
  console.log(`Matches by method: ${JSON.stringify(byMethod(toWrite))}\n`);

  if (conflicts.length) {
    console.log("Conflicts (existing link disagrees — review by hand):");
    conflicts.forEach((c) => console.log(c));
    console.log("");
  }

  if (heldBack.length) {
    console.log("Name-only matches (re-run with --names to include):");
    for (const e of heldBack) {
      console.log(
        `  row ${e.row.id} (${assetOf.get(Number(e.row.laptops_id)) ?? "?"}) → ` +
          `student ${e.students_id}, family ${e.families_id}`
      );
    }
    console.log("");
  }

  if (!toWrite.length) {
    console.log("Nothing to write.");
    return;
  }

  console.log("Rows to link:");
  for (const e of toWrite) {
    const open = e.row.returned_date ? "" : " [open]";
    console.log(
      `  row ${String(e.row.id).padStart(4)} ` +
        `${(assetOf.get(Number(e.row.laptops_id)) ?? "?").padEnd(8)} → ` +
        `student ${String(e.students_id).padEnd(4)} family ` +
        `${String(e.families_id).padEnd(4)} (${e.method})${open}`
    );
  }

  if (dryRun) {
    console.log(
      `\nDry run — ${toWrite.length} rows would be updated. ` +
        `Re-run with --confirm to write.`
    );
    return;
  }

  console.log("");
  let ok = 0;
  const failed: string[] = [];
  // Sequential: ~200 rows is small, and a serial loop keeps the
  // failure report readable if Xano starts rejecting mid-run.
  for (const e of toWrite) {
    const res = await fetch(`${opsBase}/laptop_assignments/${e.row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enrolled_students_id: e.students_id,
        enrolled_families_id: e.families_id,
      }),
    });
    if (res.ok) {
      ok++;
      console.log(`  ✓ row ${e.row.id} → student ${e.students_id}`);
    } else {
      const msg = `row ${e.row.id}: ${res.status} ${await res.text()}`;
      failed.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }

  console.log(`\nLinked ${ok}/${toWrite.length} rows.`);
  if (failed.length) {
    console.error(`${failed.length} failed — re-run to retry (idempotent).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
