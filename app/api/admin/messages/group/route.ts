import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendSms } from "@/lib/sms/send";
import { resolveGroupAudience, type Stage } from "@/lib/sms/audience";

/**
 * Group SMS blast to a filtered set of families (year + stage + billing
 * status). `POST { …, dryRun: true }` returns the recipient breakdown
 * without sending — the compose UI calls it to preview before the real
 * send. The real send texts each reachable family and logs it on their
 * thread (so a group message still shows up per-family), skipping
 * opt-outs and missing numbers.
 *
 * Idempotency: the client sends a `blastId` (UUID minted when the
 * compose dialog opens). The batch is logged with template
 * `group:<yearId>:<blastId>`, and before sending we skip any family
 * that already has a message logged under that template — so a retry
 * after a timeout / dropped response resumes instead of double-texting
 * the families that already went out.
 */
export const maxDuration = 300;

const STAGES: Stage[] = ["applicant", "accepted", "enrolled"];
const BLAST_ID_RE = /^[\w-]{6,64}$/;

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "A school year is required" },
        { status: 400 }
      );
    }

    // Strict stage validation — a typo'd stage must NOT silently widen
    // the blast to every family in the year. Absent/empty means "all
    // stages" only as the explicit, documented default.
    let stages: Stage[] = [];
    if (body.stages !== undefined) {
      if (
        !Array.isArray(body.stages) ||
        body.stages.some((s: unknown) => !STAGES.includes(s as Stage))
      ) {
        return NextResponse.json(
          { error: `stages must be an array drawn from: ${STAGES.join(", ")}` },
          { status: 400 }
        );
      }
      stages = body.stages as Stage[];
    }

    const onlyOutstanding = body.onlyOutstanding === true;
    const dryRun = body.dryRun === true;
    const text = typeof body.body === "string" ? body.body.trim() : "";

    if (!dryRun && !text) {
      return NextResponse.json(
        { error: "Message body is required" },
        { status: 400 }
      );
    }

    // Required on real sends (the dialog always mints one); optional on
    // dry runs, which send nothing.
    const blastId = typeof body.blastId === "string" ? body.blastId : "";
    if (!dryRun && !BLAST_ID_RE.test(blastId)) {
      return NextResponse.json(
        { error: "A valid blastId is required" },
        { status: 400 }
      );
    }

    const audience = await resolveGroupAudience({
      yearId,
      stages,
      onlyOutstanding,
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        matched: audience.matched,
        sendable: audience.sendable,
        optedOut: audience.optedOut,
        noPhone: audience.noPhone,
      });
    }

    // One template value per blast: greppable in the log, renders as a
    // staff message on each thread (the `group:` prefix keeps it out of
    // the "automated" tint), and doubles as the idempotency key.
    const template = `group:${yearId}:${blastId}`;

    // Resume support — skip families this exact blast already texted
    // (retry after a timeout or dropped response). Best-effort: if the
    // log read fails we proceed; worst case is a duplicate text, and
    // failed sends were logged with status "failed" so they DO retry.
    const alreadySent = new Set<number>();
    try {
      const priorMessages = await xano.smsMessages.getAll();
      for (const m of priorMessages) {
        // Group blasts are family-only, so a resume row always carries
        // the family FK — but the column is nullable now (inquiry/camp
        // messages), hence the guard.
        if (
          m.template === template &&
          m.status !== "failed" &&
          m.registration_families_id
        ) {
          alreadySent.add(m.registration_families_id);
        }
      }
    } catch {
      // proceed without resume data
    }

    const targets = audience.recipients.filter(
      (r) => r.sendable && !alreadySent.has(r.familyId)
    );

    // Bounded concurrency — fast enough for a few hundred families
    // without hammering the Twilio API. The Messaging Service also
    // queues/rate-limits on its side.
    const CONCURRENCY = 5;
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((r) =>
          sendSms({
            familyId: r.familyId,
            yearId,
            template,
            body: text,
            // Keep BOTH: `parent` re-engages sendSms's opt-out gate as
            // the final consent authority; `to` pins the number the
            // audience preview showed.
            parent: r.parent,
            to: r.e164,
            author: { email: admin.email, name: admin.name },
          }).catch(() => ({ ok: false as const }))
        )
      );
      for (const res of results) {
        if (res.ok) sent += 1;
        else failed += 1;
      }
    }

    return NextResponse.json({
      matched: audience.matched,
      sendable: audience.sendable,
      sent,
      failed,
      alreadySent: alreadySent.size,
      skippedOptedOut: audience.optedOut,
      skippedNoPhone: audience.noPhone,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
