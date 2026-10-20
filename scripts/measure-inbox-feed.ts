/**
 * Times the Xano reads behind GET /api/admin/messages (inbox feed)
 * straight from a script — no Clerk session, no Next Data Cache, so
 * every number is a COLD read against Xano. Run from the worktree root:
 *
 *   npx tsx scripts/measure-inbox-feed.ts [legacy|windowreads|window|full|audience|all]
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

type Fn = () => Promise<unknown>;

async function timed(label: string, fn: Fn) {
  const t0 = performance.now();
  const out = await fn();
  const ms = performance.now() - t0;
  const rows = Array.isArray(out) ? out.length : -1;
  const bytes = JSON.stringify(out ?? null).length;
  console.log(
    `${label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms  ${rows >= 0 ? `${rows} rows` : ""}  ${(bytes / 1024).toFixed(0)} KB`
  );
  return out;
}

async function main() {
  const which = process.argv[2] ?? "all";
  const { xano } = await import("../lib/xano");
  const years = await xano.schoolYears.getAll();
  const year =
    years.find((y) => y.isNextYear) ?? years.find((y) => y.isActive) ?? years[0];
  console.log(`year ${year.id} (${year.year_name})\n`);
  const extraYearIds = years
    .filter((y) => (y.isActive || y.isNextYear) && y.id !== year.id)
    .map((y) => y.id);

  if (which === "legacy" || which === "all") {
    console.log("── LEGACY full feed reads (the route before this PR) ──");
    const t0 = performance.now();
    await Promise.all([
      timed("sms_messages getAll", () => xano.smsMessages.getAll()),
      timed("registration_calls getAll", () => xano.calls.getAll()),
      timed("families getAll", () => xano.families.getAll()),
      timed("inquiries getAll", () => xano.inquiries.getAll()),
      timed("summer_camp getAll", () => xano.summerCamp.getAll()),
      timed("waivers getAll", () => xano.websiteWaivers.getAll()),
      timed("tasco getAll", () => xano.tascoSummerVisits.getAll()),
      timed("parents getAll", () => xano.parents.getAll()),
      timed("students getAll", () => xano.students.getAll()),
      timed("fap getByYear", () => xano.familyApplicationProgress.getByYear(year.id)),
      timed("srp getByYear", () => xano.studentRegistrationProgress.getByYear(year.id)),
    ]);
    await timed("school_years getAll", () => xano.schoolYears.getAll());
    await Promise.all(
      extraYearIds.map((id) =>
        timed(`srp getByYear(${id}) extra`, () =>
          xano.studentRegistrationProgress.getByYear(id)
        )
      )
    );
    console.log(`LEGACY wall: ${(performance.now() - t0).toFixed(0)} ms\n`);
  }

  if (which === "windowreads" || which === "all") {
    console.log("── WINDOW feed reads, individually (cold) ──");
    const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const t0 = performance.now();
    await Promise.all([
      timed("sms_messages getSince(14d)", () => xano.smsMessages.getSince(since)),
      timed("registration_calls getSince(14d)", () => xano.calls.getSince(since)),
      timed("families getAll", () => xano.families.getAll()),
      timed("inquiries getAll", () => xano.inquiries.getAll()),
      timed("summer_camp getAll", () => xano.summerCamp.getAll()),
      timed("waivers getAll", () => xano.websiteWaivers.getAll()),
      timed("tasco getAll", () => xano.tascoSummerVisits.getAll()),
      timed("fap getByYear", () => xano.familyApplicationProgress.getByYear(year.id)),
      timed("srp getByYear", () => xano.studentRegistrationProgress.getByYear(year.id)),
    ]);
    console.log(`WINDOW reads wall: ${(performance.now() - t0).toFixed(0)} ms
`);
    console.log("── the same, uncached-only subset (what a warm Data Cache leaves) ──");
    const t1 = performance.now();
    await Promise.all([
      timed("sms_messages getSince(14d)", () => xano.smsMessages.getSince(since)),
      timed("registration_calls getSince(14d)", () => xano.calls.getSince(since)),
      timed("fap getByYear", () => xano.familyApplicationProgress.getByYear(year.id)),
      timed("srp getByYear", () => xano.studentRegistrationProgress.getByYear(year.id)),
    ]);
    console.log(`WINDOW uncached-subset wall: ${(performance.now() - t1).toFixed(0)} ms
`);
  }

  if (which === "window" || which === "full" || which === "all") {
    const { buildInboxFeed } = await import(
      "../lib/sms/inbox-feed"
    );
    if (which !== "full") {
      const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const t0 = performance.now();
      const out = await buildInboxFeed({ yearId: year.id, since });
      console.log(
        `WINDOW feed wall: ${(performance.now() - t0).toFixed(0)} ms  ${out.conversations.length} conversations  ${(JSON.stringify(out).length / 1024).toFixed(0)} KB\n`
      );
    }
    if (which !== "window") {
      const t0 = performance.now();
      const out = await buildInboxFeed({ yearId: year.id });
      console.log(
        `FULL feed wall: ${(performance.now() - t0).toFixed(0)} ms  ${out.conversations.length} conversations  ${(JSON.stringify(out).length / 1024).toFixed(0)} KB\n`
      );
    }
  }

  if (which === "audience" || which === "all") {
    console.log("── audience reads ──");
    const t0 = performance.now();
    await Promise.all([
      timed("fap getByYear", () => xano.familyApplicationProgress.getByYear(year.id)),
      timed("srp getByYear", () => xano.studentRegistrationProgress.getByYear(year.id)),
      timed("applications getAll", () => xano.applications.getAll()),
      timed("students getAll", () => xano.students.getAll()),
      timed("families getAllDetails", () => xano.families.getAllDetails()),
      timed("inquiries getAll", () => xano.inquiries.getAll()),
      timed("summer_camp getAll", () => xano.summerCamp.getAll()),
      timed("txns getAllByYear", () => xano.paymentTransactions.getAllByYear(year.id)),
      timed("packets getByYear", () => xano.studentRegistration.getByYear(year.id)),
    ]);
    await Promise.all([
      timed("waivers getAll", () => xano.websiteWaivers.getAll()),
      timed("tasco getAll", () => xano.tascoSummerVisits.getAll()),
    ]);
    console.log(`AUDIENCE wall: ${(performance.now() - t0).toFixed(0)} ms\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
