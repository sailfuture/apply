import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendEmail } from "@/lib/emails/send";
import { volunteerHoursRecap } from "@/lib/emails/templates";
import {
  VOLUNTEER_RECAP_TAG,
  loadVolunteerRecaps,
  type VolunteerRecapFamily,
} from "@/lib/volunteer-recap";

// One Resend call + one log write per family, two at a time.
export const maxDuration = 300;

/** A family that already got the recap inside this window is skipped
 *  by the send-to-everyone button, so a retry after a timeout or a
 *  second click doesn't email anyone twice. */
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;

export interface VolunteerRecapListRow {
  id: number;
  /** Every family record this one email covers (usually just one). */
  familyIds: number[];
  name: string;
  students: string;
  emails: string[];
  completed: number;
  remaining: number;
}

export interface VolunteerRecapListResponse {
  yearName: string;
  families: VolunteerRecapListRow[];
}

export interface VolunteerRecapPreviewResponse {
  subject: string;
  html: string;
  to: string[];
}

export interface VolunteerRecapSendResponse {
  sent: number;
  /** Already emailed inside the guard window. */
  alreadySent: number;
  /** No parent email on file. */
  noEmail: number;
  failed: number;
  failedFamilies: string[];
}

function parseYearId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Volunteer-hours recap emails (Parents → Volunteer Hours).
 *
 *   GET ?yearId=Y            → the enrolled families the recap can go
 *                              to, with their hours and addresses.
 *                              One row per household: family records
 *                              that share a parent email are one row.
 *   GET ?yearId=Y&familyId=F → that family's email exactly as it would
 *                              send (subject + HTML), for the preview.
 *   POST { yearId, familyIds, resend? } → sends one recap per family
 *     through Resend. `resend: true` (the single-family button) skips
 *     the already-sent guard.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = parseYearId(req.nextUrl.searchParams.get("yearId"));
    if (!yearId) {
      return NextResponse.json({ error: "yearId is required" }, { status: 400 });
    }
    const recaps = await loadVolunteerRecaps(yearId);

    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    if (familyIdParam) {
      const family = recaps.families.find(
        (f) => f.familyIds.includes(Number(familyIdParam))
      );
      if (!family) {
        return NextResponse.json(
          { error: "That family isn't enrolled for this school year." },
          { status: 404 }
        );
      }
      const content = volunteerHoursRecap(family.context);
      return NextResponse.json({
        subject: content.subject,
        html: content.html,
        to: family.emails,
      } satisfies VolunteerRecapPreviewResponse);
    }

    return NextResponse.json({
      yearName: recaps.yearName,
      families: recaps.families.map((f) => ({
        id: f.id,
        familyIds: f.familyIds,
        name: f.name,
        students: f.students,
        emails: f.emails,
        completed: f.context.hours_completed,
        remaining: f.context.hours_remaining,
      })),
    } satisfies VolunteerRecapListResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

type Outcome = "sent" | "alreadySent" | "noEmail" | "failed";

async function sendOne(
  family: VolunteerRecapFamily,
  yearId: number,
  resend: boolean
): Promise<Outcome> {
  if (family.emails.length === 0) return "noEmail";
  try {
    if (!resend) {
      // Strict read: an unreadable log must not look like "never sent".
      const log = await xano.emailNotifications.getByFamilyStrict(
        family.id,
        yearId
      );
      const cutoff = Date.now() - RESEND_GUARD_MS;
      if (
        log.some(
          (r) =>
            r.template === VOLUNTEER_RECAP_TAG &&
            r.status === "sent" &&
            Number(r.created_at) >= cutoff
        )
      ) {
        return "alreadySent";
      }
    }
    const result = await sendEmail({
      to: family.emails,
      content: volunteerHoursRecap(family.context),
      // No dean@/admissions@ copy: a send to every family would put
      // one copy per family in those inboxes. Each send is on the
      // family's email log instead.
      cc: [],
      tag: VOLUNTEER_RECAP_TAG,
      familyId: family.id,
      yearId,
    });
    return result.ok ? "sent" : "failed";
  } catch (err) {
    console.error(
      `[volunteer-recap] send failed for family=${family.id}:`,
      err
    );
    return "failed";
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const yearId = parseYearId(body?.yearId);
    if (!yearId) {
      return NextResponse.json({ error: "yearId is required" }, { status: 400 });
    }
    const rawIds: unknown[] = Array.isArray(body?.familyIds)
      ? body.familyIds
      : [];
    const wanted = new Set(
      rawIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
    );
    if (wanted.size === 0) {
      return NextResponse.json(
        { error: "familyIds is required" },
        { status: 400 }
      );
    }
    const resend = body?.resend === true;

    const recaps = await loadVolunteerRecaps(yearId);
    // A household is one target however many of its family records
    // were asked for, so it can never be emailed twice in one send.
    const targets = recaps.families.filter((f) =>
      f.familyIds.some((id) => wanted.has(id))
    );
    if (targets.length === 0) {
      return NextResponse.json(
        { error: "None of those families are enrolled for this school year." },
        { status: 400 }
      );
    }

    const result: VolunteerRecapSendResponse = {
      sent: 0,
      alreadySent: 0,
      noEmail: 0,
      failed: 0,
      failedFamilies: [],
    };
    // Two at a time keeps the batch under Resend's per-second limit.
    for (let i = 0; i < targets.length; i += 2) {
      const pair = targets.slice(i, i + 2);
      const outcomes = await Promise.all(
        pair.map((f) => sendOne(f, yearId, resend))
      );
      outcomes.forEach((o, idx) => {
        result[o] += 1;
        if (o === "failed") result.failedFamilies.push(pair[idx].name);
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleAdminError(err);
  }
}
