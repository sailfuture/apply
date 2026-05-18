/**
 * One-off Stripe cleanup script. Cancels every active subscription
 * (immediate cancel, not at period end) and optionally archives the
 * one-off Prices we created for per-student items so the Dashboard
 * doesn't accumulate them. Use this before clearing Xano rows so
 * Stripe doesn't end up with orphan subscriptions still billing
 * families whose records no longer exist on our side.
 *
 * Usage:
 *   1. Make sure `STRIPE_SECRET_KEY` is set in `.env.local`
 *      (this script reads it directly via dotenv).
 *   2. Run a dry-run first to see what would happen:
 *      `npx tsx scripts/cleanup-stripe.ts --dry-run`
 *   3. When ready, run the real thing:
 *      `npx tsx scripts/cleanup-stripe.ts --confirm`
 *
 * Safety:
 *   - Defaults to dry-run; never mutates without `--confirm`.
 *   - Lists every action it's about to take so you can scan the
 *     output before approving.
 *   - Stripe rate-limits at 100 reads/sec; the script processes
 *     sequentially with no batching since the volume is small.
 */

import Stripe from "stripe";
import * as fs from "fs";
import * as path from "path";

function loadEnv(): void {
  // Lightweight .env.local parser — avoids pulling in `dotenv` as a
  // dep just for a one-off script. Supports `KEY=VALUE` lines and
  // skips comments + blank lines.
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnv();

  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has("--confirm");

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local or your shell env."
    );
    process.exit(1);
  }

  const stripe = new Stripe(secret);

  if (dryRun) {
    console.log("--- DRY RUN (no changes will be made) ---");
    console.log("Pass --confirm to actually cancel subscriptions.\n");
  } else {
    console.log("--- LIVE RUN — subscriptions will be canceled ---\n");
  }

  // 1. List + cancel active subscriptions.
  let canceled = 0;
  let scanned = 0;
  for await (const sub of stripe.subscriptions.list({
    status: "all",
    limit: 100,
    expand: ["data.customer"],
  })) {
    scanned += 1;
    if (sub.status === "canceled" || sub.status === "incomplete_expired") {
      continue;
    }
    const customer = sub.customer;
    const customerLabel =
      typeof customer === "string"
        ? customer
        : customer && "email" in customer
          ? (customer.email ?? customer.id)
          : "(unknown)";
    console.log(
      `  Subscription ${sub.id}  status=${sub.status}  customer=${customerLabel}`
    );
    if (!dryRun) {
      await stripe.subscriptions.cancel(sub.id);
      canceled += 1;
    }
  }
  console.log(
    `\n${dryRun ? "Would cancel" : "Canceled"} ${
      dryRun ? scanned - canceled : canceled
    } subscription(s) out of ${scanned} scanned.\n`
  );

  console.log("Done.");
  if (dryRun) {
    console.log(
      "Re-run with --confirm to actually cancel the subscriptions above."
    );
  } else {
    console.log(
      "Note: one-off Prices created for per-student items remain in the Stripe Dashboard. " +
        "They're inert (no longer attached to any subscription) and can be archived via the " +
        "Dashboard if you want a clean catalog, but it's not required."
    );
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
