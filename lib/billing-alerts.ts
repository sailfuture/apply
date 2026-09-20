import { getResend, getFromAddress } from "@/lib/emails/resend";
import { formatUSPhone } from "@/lib/phone";
import { stripeCustomerDashboardUrl } from "@/lib/stripe-dashboard";
import { xano, type XanoParent, type XanoStudent } from "@/lib/xano";

/**
 * Internal billing alert email — the "a human must know about this"
 * channel for billing failures that would otherwise sit silent: a
 * family's invoice payment failed, Stripe's dunning canceled a
 * subscription, a live subscription has no mirrored invoices, a
 * refund couldn't be recorded, etc.
 *
 * Deliberately NOT the parent-facing email pipeline (`lib/emails`) —
 * no template, no per-family audit row, no dedupe. Plain text to the
 * staff billing inbox. Best-effort: never throws, because every call
 * site is itself inside a billing operation that must not fail on a
 * notification problem.
 *
 * Call sites pass a `BillingAlertContext` of raw ids; this module
 * resolves them to the names, emails, academic year, billing month
 * and deep links staff actually need. Resolution is entirely
 * best-effort — an alert with raw ids still beats no alert, so every
 * lookup failure degrades to the id form rather than aborting the
 * send.
 *
 * Returns whether the send succeeded, for the rare call site where
 * the alert is the ONLY durable outcome of handling an event (the
 * webhook's stray-subscription branch) and a failed send must feed
 * back into the caller's retry loop. Everywhere else the return is
 * ignored and the alert stays fire-and-forget.
 */

/** The invoice an alert is about. Timestamps are unix MILLISECONDS —
 *  the mirror's convention (`XanoPaymentTransaction`, and the `* 1000`
 *  the webhook already applies to Stripe's seconds), so no call site
 *  has to pick a unit. */
export interface BillingAlertInvoice {
  id?: string | null;
  status?: string | null;
  amountDueCents?: number | null;
  amountPaidCents?: number | null;
  /** Unix ms. */
  periodStart?: number | null;
  /** Unix ms. The billing-cycle date — see `billingMonthLabel`. */
  periodEnd?: number | null;
  /** Unix ms. */
  dueDate?: number | null;
  hostedUrl?: string | null;
}

export interface BillingAlertContext {
  familyId?: number | null;
  yearId?: number | null;
  /** Students this alert is specifically about. Omit for family-wide
   *  alerts and the family's active students are listed instead. */
  studentIds?: number[];
  subscriptionId?: string | null;
  invoice?: BillingAlertInvoice | null;
  /** Extra "label: value" rows for the detail block, for facts only
   *  the call site knows (e.g. the year a student moved from). */
  extra?: Record<string, string | null | undefined>;
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
  );
}

function formatMoney(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

/**
 * Invoice dates render in UTC, not Eastern, on purpose: Stripe anchors
 * subscription cycles to UTC midnight and `lib/billing-schedule.ts`
 * buckets the mirrored invoices into month slots the same way. An ET
 * render of a UTC-midnight boundary lands on the previous evening, so
 * an alert would name a different month than the family's billing
 * schedule page for the very same invoice.
 */
function formatDate(unixMs: number | null | undefined): string | null {
  if (!unixMs) return null;
  return new Date(unixMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The month an invoice belongs to, keyed on `period_end` — the cycle
 *  boundary the invoice was generated on. Matches
 *  `transactionMonthKey` in `lib/billing-schedule.ts`; keying on
 *  period_start would name every invoice one month early. */
function billingMonthLabel(
  invoice: BillingAlertInvoice
): string | null {
  const basis = invoice.periodEnd || invoice.periodStart || 0;
  if (!basis) return null;
  return new Date(basis).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function parentLine(p: XanoParent): string {
  const name = [p.first_name, p.last_name]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const phone = p.phone ? formatUSPhone(p.phone) : "";
  return [name || `parent #${p.id}`, p.email, phone].filter(Boolean).join(" · ");
}

/** "Doyley Family (#94)" — the one spelling of a family in an alert. */
function labelForFamily(
  familyName: string | null | undefined,
  familyId: number
): string {
  const name = (familyName ?? "").trim();
  return name ? `${name} (#${familyId})` : `family #${familyId}`;
}

/**
 * Resolve one family id to its display label, for the rare alert that
 * names a LIST of families (the nightly drift sweep) rather than the
 * single family `BillingAlertContext` describes. Falls back to the id
 * form on any lookup failure — same never-throw contract as the send.
 */
export async function familyAlertLabel(familyId: number): Promise<string> {
  try {
    const family = await xano.families.getById(familyId);
    return labelForFamily(family?.family_name, familyId);
  } catch (err) {
    console.error(
      `[billing-alerts] could not resolve family ${familyId}:`,
      err
    );
    return `family #${familyId}`;
  }
}

function studentName(s: XanoStudent): string {
  const name = [s.first_name, s.last_name]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || `student #${s.id}`;
}

interface ResolvedAlertContext {
  /** "Doyley Family (#94)" — or "family #94" when the lookup failed. */
  familyLabel: string | null;
  /** "2026-2027" — or "year #2" when the lookup failed. */
  yearLabel: string | null;
  /** The headline: "Doyley Family (#94) · 2026-2027 · September 2026". */
  headline: string | null;
  detailRows: [string, string][];
  links: [string, string][];
}

/**
 * Turn the raw ids on a `BillingAlertContext` into the human detail
 * block. Every lookup is individually guarded: a family read that
 * fails still leaves the year, the invoice figures and the links
 * intact, and the block falls back to the id form for whatever
 * couldn't be resolved.
 */
async function resolveAlertContext(
  ctx: BillingAlertContext
): Promise<ResolvedAlertContext> {
  const yearId =
    typeof ctx.yearId === "number" && Number.isFinite(ctx.yearId)
      ? ctx.yearId
      : null;

  const detailRows: [string, string][] = [];
  const links: [string, string][] = [];

  let familyId =
    typeof ctx.familyId === "number" && Number.isFinite(ctx.familyId)
      ? ctx.familyId
      : null;
  let familyLabel: string | null = null;
  let yearLabel = yearId ? `year #${yearId}` : null;
  let customerId: string | null = null;

  // Students first: the alert is read as "which kids is this about",
  // then "who do I call about it". Named ids win over the family's
  // roster so a student-scoped alert says only who it means.
  const wanted = (ctx.studentIds ?? []).filter((n) => Number.isFinite(n));
  let students: XanoStudent[] = [];
  try {
    if (wanted.length > 0) {
      students = await Promise.all(
        wanted.map((id) => xano.students.getById(id))
      );
    } else if (familyId) {
      students = await xano.students.getByFamilyId(familyId);
    }
  } catch (err) {
    console.error(
      `[billing-alerts] could not resolve students ${wanted.join(", ") || `for family ${familyId}`}:`,
      err
    );
  }
  const studentNames = students.map(studentName).filter(Boolean);
  if (studentNames.length > 0) {
    detailRows.push([
      studentNames.length === 1 ? "Student" : "Students",
      studentNames.join(", "),
    ]);
  }

  // A call site that only had student ids on hand (or whose family FK
  // read as 0/NaN) still gets the whole family block — borrow the
  // family off the first student.
  if (!familyId && students.length > 0) {
    const ownerId = Number(students[0]?.registration_families_id);
    if (Number.isFinite(ownerId) && ownerId > 0) familyId = ownerId;
  }

  if (familyId) {
    familyLabel = `family #${familyId}`;
    try {
      const family = await xano.families.getById(familyId);
      familyLabel = labelForFamily(family?.family_name, familyId);
      customerId = family?.stripe_customer_id ?? null;

      // Prefer the parents Xano already expanded onto the family row;
      // fall back to fetching each id when it served bare numbers.
      let parents: XanoParent[] = xano.families.getEmbeddedParents(family);
      if (parents.length === 0) {
        const parentIds = xano.families.getParentIds(family);
        parents = await Promise.all(
          parentIds.map((id) => xano.parents.getById(id))
        );
      }
      const parentLines = [...parents]
        .sort((a, b) => a.id - b.id)
        .map(parentLine)
        .filter(Boolean);
      if (parentLines.length > 0) {
        detailRows.push([
          parentLines.length === 1 ? "Parent" : "Parents",
          parentLines.join("\n"),
        ]);
      }
    } catch (err) {
      console.error(
        `[billing-alerts] could not resolve family ${familyId}:`,
        err
      );
    }
  }

  if (yearId) {
    try {
      const year = await xano.schoolYears.getById(yearId);
      const name = (year?.year_name ?? "").trim();
      if (name) yearLabel = name;
    } catch (err) {
      console.error(
        `[billing-alerts] could not resolve school year ${yearId}:`,
        err
      );
    }
  }

  for (const [label, value] of Object.entries(ctx.extra ?? {})) {
    const clean = (value ?? "").trim();
    if (clean) detailRows.push([label, clean]);
  }

  const invoice = ctx.invoice ?? null;
  let monthLabel: string | null = null;
  if (invoice) {
    monthLabel = billingMonthLabel(invoice);
    if (monthLabel) detailRows.push(["Billing month", monthLabel]);

    const from = formatDate(invoice.periodStart);
    const to = formatDate(invoice.periodEnd);
    if (from && to) detailRows.push(["Billing period", `${from} – ${to}`]);

    if (invoice.amountDueCents != null) {
      const paid = invoice.amountPaidCents ?? 0;
      detailRows.push([
        "Amount due",
        paid > 0
          ? `${formatMoney(invoice.amountDueCents)} (${formatMoney(paid)} collected)`
          : `${formatMoney(invoice.amountDueCents)} (nothing collected)`,
      ]);
    }

    const due = formatDate(invoice.dueDate);
    if (due) detailRows.push(["Due date", due]);

    if (invoice.id) {
      detailRows.push([
        "Stripe invoice",
        invoice.status ? `${invoice.id} (${invoice.status})` : invoice.id,
      ]);
    }
  }

  if (ctx.subscriptionId) {
    detailRows.push(["Stripe subscription", ctx.subscriptionId]);
  }

  if (familyId) {
    links.push([
      "Family billing page",
      `${appUrl()}/admin/families/${familyId}/billing`,
    ]);
  }
  if (invoice?.hostedUrl) {
    links.push(["Hosted invoice", invoice.hostedUrl]);
  }
  if (customerId) {
    links.push(["Stripe customer", stripeCustomerDashboardUrl(customerId)]);
  }

  const headlineParts = [familyLabel, yearLabel, monthLabel].filter(
    (p): p is string => Boolean(p)
  );

  return {
    familyLabel,
    yearLabel,
    headline: headlineParts.length > 0 ? headlineParts.join(" · ") : null,
    detailRows,
    links,
  };
}

/** Pad labels to a common width so the detail block reads as a table
 *  in a monospace-ish mail client and still scans fine in a
 *  proportional one. Multi-line values (the parent list) indent their
 *  continuation lines to the same column. */
function renderRows(rows: [string, string][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map(([label]) => label.length)) + 1;
  const out: string[] = [];
  for (const [label, value] of rows) {
    const gutter = " ".repeat(width + 1);
    const [first, ...rest] = value.split("\n");
    out.push(`${`${label}:`.padEnd(width + 1)}${first}`);
    for (const line of rest) out.push(`${gutter}${line}`);
  }
  return out;
}

export async function sendBillingAlert(
  subject: string,
  lines: string[],
  context: BillingAlertContext = {}
): Promise<boolean> {
  try {
    const to =
      process.env.BILLING_ALERTS_EMAIL ?? "admissions@sailfuture.org";

    // Resolution touches Xano, so it gets the same never-throw
    // treatment as the send itself — an alert that can't name the
    // family still has to reach the inbox.
    let resolved: ResolvedAlertContext;
    try {
      resolved = await resolveAlertContext(context);
    } catch (err) {
      console.error(
        `[billing-alerts] context resolution failed for "${subject}":`,
        err
      );
      resolved = {
        familyLabel: null,
        yearLabel: null,
        headline: null,
        detailRows: [],
        links: [],
      };
    }

    // The subject carries the family so the billing inbox is
    // skimmable without opening anything — "Tuition payment failed —
    // Doyley Family (#94) · 2026-2027".
    const subjectSuffix = [resolved.familyLabel, resolved.yearLabel]
      .filter(Boolean)
      .join(" · ");
    const fullSubject = subjectSuffix
      ? `[Billing alert] ${subject} — ${subjectSuffix}`
      : `[Billing alert] ${subject}`;

    const body: string[] = [];
    if (resolved.headline) {
      body.push(resolved.headline, "─".repeat(resolved.headline.length));
    }
    body.push(...renderRows(resolved.detailRows));
    if (resolved.detailRows.length > 0) body.push("");
    body.push(...lines);
    if (resolved.links.length > 0) {
      body.push("", ...renderRows(resolved.links));
    }
    body.push(
      "",
      "— Automated alert from the SailFuture Apply billing pipeline."
    );

    const { error } = await getResend().emails.send({
      from: getFromAddress(),
      to,
      subject: fullSubject,
      text: body.join("\n"),
    });
    // Resend reports API-level failures on the `error` field rather
    // than throwing — a send that "succeeded" with an error attached
    // never reached the inbox.
    if (error) {
      console.error(
        `[billing-alerts] failed to send alert "${subject}":`,
        error
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[billing-alerts] failed to send alert "${subject}":`,
      err
    );
    return false;
  }
}
