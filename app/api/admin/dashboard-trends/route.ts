import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * 30-day trend series for the admin dashboard charts.
 *
 * Two series, deliberately different shapes because the underlying
 * events are different densities:
 *
 *   - `inquiries.daily` — NEW inquiries per day. Dense enough
 *     (dozens a month, often several a day) that per-day bars read
 *     well.
 *   - `enrollment.cumulative` — roster SIZE at the end of each day.
 *     Confirmations are sparse (a handful a month), so per-day bars
 *     would be mostly empty; the cumulative curve answers the actual
 *     question ("how big is the roster, and is it growing?").
 *
 * Enrollment timestamp is the packet's
 * `registration_confirmed_admin_time` — when admin clicked Confirm
 * Registration. Students enrolled BEFORE the window form the
 * baseline the curve starts from, so the chart never implies the
 * roster began at zero 30 days ago.
 *
 * Buckets are UTC days. The client formats the returned `YYYY-MM-DD`
 * strings as-is (no timezone re-interpretation), so server and
 * browser always agree on which bar is which day.
 */

export interface DashboardTrendsResponse {
  /** 30 `YYYY-MM-DD` UTC dates, oldest first. */
  days: string[];
  inquiries: {
    /** New inquiries per day, aligned to `days`. */
    daily: number[];
    /** Total across the window. */
    total: number;
    /** Total across the PRIOR 30 days — powers the delta chip. */
    previousTotal: number;
  };
  enrollment: {
    /** Roster size at the end of each day, aligned to `days`. */
    cumulative: number[];
    /** New confirmations per day, aligned to `days`. */
    added: number[];
    /** Roster size right now (end of the window). */
    current: number;
    /** Confirmations inside the window. */
    addedInWindow: number;
  };
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

/** `YYYY-MM-DD` for a timestamp, in UTC. */
function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = yearIdParam ? Number(yearIdParam) : null;

    // Every read is isolated: one failing table degrades its own
    // series to zeros rather than 500-ing the whole dashboard.
    const [inquiriesRes, packetsRes, studentsRes, appsRes] =
      await Promise.allSettled([
        xano.inquiries.getAll(),
        xano.studentRegistration.getAll(),
        xano.students.getAll(),
        xano.applications.getAll(),
      ]);
    for (const [label, r] of [
      ["inquiries", inquiriesRes],
      ["packets", packetsRes],
      ["students", studentsRes],
      ["applications", appsRes],
    ] as const) {
      if (r.status === "rejected") {
        console.error(
          `[/api/admin/dashboard-trends] failed to load ${label}:`,
          r.reason
        );
      }
    }
    const inquiries =
      inquiriesRes.status === "fulfilled" ? inquiriesRes.value : [];
    const packets = packetsRes.status === "fulfilled" ? packetsRes.value : [];
    const students =
      studentsRes.status === "fulfilled" ? studentsRes.value : [];
    const apps = appsRes.status === "fulfilled" ? appsRes.value : [];

    // Window: the last 30 UTC days ending today (inclusive).
    const now = Date.now();
    const todayStart = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
    const days: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      days.push(utcDay(todayStart - i * DAY_MS));
    }
    const windowStart = todayStart - (WINDOW_DAYS - 1) * DAY_MS;
    const indexOfDay = new Map(days.map((d, i) => [d, i]));

    /* ── Inquiries: new per day ─────────────────────────────── */
    const inquiryDaily = new Array<number>(WINDOW_DAYS).fill(0);
    let previousTotal = 0;
    const priorWindowStart = windowStart - WINDOW_DAYS * DAY_MS;
    for (const i of inquiries) {
      const ts = Number(i.created_at);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const idx = indexOfDay.get(utcDay(ts));
      if (idx !== undefined) {
        inquiryDaily[idx] += 1;
      } else if (ts >= priorWindowStart && ts < windowStart) {
        previousTotal += 1;
      }
    }

    /* ── Enrollment: roster size per day ────────────────────── */
    // Year scope mirrors the stats tiles: a student belongs to the
    // selected year through an active application for it.
    const activeApps = apps.filter(
      (a) => (a as { isActive?: boolean }).isActive !== false
    );
    const yearStudentIds = yearId
      ? new Set(
          activeApps
            .filter((a) => Number(a.registration_school_years_id) === yearId)
            .map((a) => Number(a.registration_students_id))
        )
      : null;

    // Confirmation timestamp per student, from their packet. When a
    // student has several packets (multi-year), the earliest confirm
    // is when they first joined the roster.
    const confirmedAtByStudent = new Map<number, number>();
    for (const p of packets) {
      const ts = Number(p.registration_confirmed_admin_time);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      if (yearId && Number(p.registration_school_years_id) !== yearId) {
        continue;
      }
      const sid = Number(p.registration_students_id);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      const existing = confirmedAtByStudent.get(sid);
      if (existing === undefined || ts < existing) {
        confirmedAtByStudent.set(sid, ts);
      }
    }

    // Only students who are enrolled TODAY count toward the roster
    // curve — a withdrawn student shouldn't leave a permanent bump in
    // the history. (Withdrawals have no per-year timestamp to
    // subtract at the right point, so the honest reading is "current
    // roster, by when each member joined".)
    const enrolledNow = students.filter(
      (s) =>
        s.isEnrolled === true &&
        s.isArchived !== true &&
        (!yearStudentIds || yearStudentIds.has(s.id))
    );

    const added = new Array<number>(WINDOW_DAYS).fill(0);
    let baseline = 0; // enrolled before the window opened
    let undated = 0; // enrolled, but no confirm timestamp on file
    for (const s of enrolledNow) {
      const ts = confirmedAtByStudent.get(s.id);
      if (ts === undefined) {
        undated += 1;
        continue;
      }
      const idx = indexOfDay.get(utcDay(ts));
      if (idx !== undefined) added[idx] += 1;
      else if (ts < windowStart) baseline += 1;
      // Future-dated stamps (clock skew) are ignored.
    }
    // Undated members are part of today's roster and predate anything
    // we can place, so they belong in the baseline — otherwise the
    // curve would end below the real headcount.
    baseline += undated;

    const cumulative: number[] = [];
    let running = baseline;
    for (let i = 0; i < WINDOW_DAYS; i++) {
      running += added[i];
      cumulative.push(running);
    }

    const payload: DashboardTrendsResponse = {
      days,
      inquiries: {
        daily: inquiryDaily,
        total: inquiryDaily.reduce((a, b) => a + b, 0),
        previousTotal,
      },
      enrollment: {
        cumulative,
        added,
        current: cumulative[cumulative.length - 1] ?? 0,
        addedInWindow: added.reduce((a, b) => a + b, 0),
      },
    };
    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}
