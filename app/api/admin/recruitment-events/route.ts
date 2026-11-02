import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { listActiveAdmins } from "@/lib/admin-auth-list";
import { getXanoHost, xano } from "@/lib/xano";
import { xanoFetch } from "@/lib/xano-fetch";
import {
  normalizeRecruitmentEvent,
  parseRecruitmentEventBody,
  type RecruitmentEvent,
} from "@/lib/recruitment-events";

/**
 * Recruitment → Events.
 *
 *   GET  /api/admin/recruitment-events
 *        → { events, staff }: every event (the page sorts, groups and
 *          filters client-side — the table is small) plus the staff
 *          names the dialog offers in its picker.
 *   POST /api/admin/recruitment-events   body: the event's columns
 *
 * Staff names come from three places so the picker is never empty
 * and never loses a name: the admin list (who uses this tool), the
 * faculty table (everyone on staff, phone or not), and whatever names
 * existing events already carry (someone typed in by hand, or who
 * has since left). Typed names are allowed too — the column is free
 * text.
 */
export interface AdminRecruitmentEventsResponse {
  events: RecruitmentEvent[];
  staff: string[];
}

export async function GET() {
  try {
    await requireAdmin();
    const [rows, admins, faculty] = await Promise.all([
      xano.recruitmentEvents.getAll(),
      listActiveAdmins().catch(() => []),
      facultyNames().catch(() => [] as string[]),
    ]);
    const events = rows
      .map(normalizeRecruitmentEvent)
      // Soonest first; same day keeps start order; ties by id so the
      // order is stable across refreshes.
      .sort(
        (a, b) =>
          a.event_date.localeCompare(b.event_date) ||
          a.start_time - b.start_time ||
          a.id - b.id
      );

    const names = new Map<string, string>();
    const add = (name: string) => {
      const n = name.trim().replace(/\s+/g, " ");
      if (!n) return;
      const key = n.toLowerCase();
      if (!names.has(key)) names.set(key, n);
    };
    for (const a of admins) add(a.name);
    for (const n of faculty) add(n);
    for (const e of events) for (const n of e.staff) add(n);

    return NextResponse.json({
      events,
      staff: [...names.values()].sort((a, b) => a.localeCompare(b)),
    } satisfies AdminRecruitmentEventsResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = parseRecruitmentEventBody(body, { forCreate: true });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const row = await xano.recruitmentEvents.create({
      start_time: 0,
      end_time: 0,
      hours: 0,
      hours_type: "",
      event_type: "",
      paid: false,
      staff: [],
      description: "",
      location: "",
      event_link: "",
      application_link: "",
      files: [],
      ...parsed,
    });
    return NextResponse.json({
      ok: true,
      event: normalizeRecruitmentEvent(row),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Every non-archived teacher's display name, from the staff
 *  `teachers` table (Xano workspace 2, read through the Toddle API
 *  group — the same source the admin list and faculty texts use). */
async function facultyNames(): Promise<string[]> {
  const res = await xanoFetch(`${getXanoHost()}/api:fJsHVIeC/teachers`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Xano error ${res.status}`);
  const rows = (await res.json()) as Array<{
    firstName?: string | null;
    lastName?: string | null;
    isArchived?: boolean | null;
  }>;
  return (Array.isArray(rows) ? rows : [])
    .filter((t) => t.isArchived !== true)
    .map((t) => `${(t.firstName ?? "").trim()} ${(t.lastName ?? "").trim()}`.trim())
    .filter(Boolean);
}
