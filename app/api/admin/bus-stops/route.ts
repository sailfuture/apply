import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Bus-stop rosters for the Operations → Bus Stops page.
 *
 *   GET /api/admin/bus-stops?yearId=Y
 *
 * One entry per stop in the `registration_bus` catalog (name, pickup /
 * drop-off times, address) with every rider assigned to it for the
 * year: active application rows with `is_bus_transportation` whose
 * student isn't archived. Stops with no riders still list — an empty
 * stop is a route-planning fact, not noise. Riders whose stop name no
 * longer matches the catalog (renamed/deleted stop) group under a
 * synthetic entry so nobody silently disappears from the rosters.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [stops, apps, students, families, parents] = await Promise.all([
      xano.busStops.getAll().catch(() => []),
      xano.applications.getAll().catch(() => []),
      xano.students.getAll().catch(() => []),
      xano.families.getAll().catch(() => []),
      xano.parents.getAll().catch(() => []),
    ]);

    const studentById = new Map(students.map((s) => [s.id, s]));
    const familyById = new Map(families.map((f) => [f.id, f]));
    // Primary parent per family — lowest id wins, the same convention
    // as the billing and enrolled surfaces.
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const primaryParent = (familyId: number) => {
      const fam = familyById.get(familyId);
      if (!fam) return null;
      const ids = xano.families.getParentIds(fam).sort((a, b) => a - b);
      for (const id of ids) {
        const p = parentById.get(id);
        if (p) return p;
      }
      return null;
    };

    // Winning application row per student — newest (highest id)
    // ACTIVE row for the year is the family's current word. A global
    // winner (not per-stop dedupe) so re-created rows can't list one
    // student under two stops, double-count the totals, or let an
    // older row's stale election override the fresh one.
    const winnerByStudent = new Map<number, (typeof apps)[number]>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const sid = Number(a.registration_students_id);
      if (!sid) continue;
      const prev = winnerByStudent.get(sid);
      if (!prev || Number(a.id) > Number(prev.id)) {
        winnerByStudent.set(sid, a);
      }
    }

    const ridersByStop = new Map<string, BusStopRider[]>();
    for (const [sid, a] of winnerByStudent) {
      if (a.is_bus_transportation !== true) continue;
      const student = studentById.get(sid);
      if (!student || student.isArchived === true) continue;
      const fid = Number(a.registration_families_id) || 0;
      const parent = primaryParent(fid);
      const stopName = (a.bus_stop ?? "").trim() || "No stop selected";
      const list = ridersByStop.get(stopName) ?? [];
      list.push({
        student_id: sid,
        student_name:
          `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
          `Student #${sid}`,
        grade: (a.current_grade ?? "").trim(),
        family_id: fid,
        family_name:
          familyById.get(fid)?.family_name?.trim() || `Family #${fid}`,
        parent_name: parent
          ? `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim()
          : "",
        parent_phone: (parent?.phone ?? "").trim(),
      });
      ridersByStop.set(stopName, list);
    }
    for (const list of ridersByStop.values()) {
      list.sort((a, b) => a.student_name.localeCompare(b.student_name));
    }

    // Catalog stops first (in name order), then any orphaned stop
    // names riders still carry.
    const catalogNames = new Set<string>();
    const out: BusStopGroup[] = [];
    for (const s of [...stops].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    )) {
      const name = (s.name ?? "").trim() || `Stop #${s.id}`;
      // One card per trimmed NAME — duplicate catalog rows would
      // otherwise each render the same rider list and double every
      // rider in Copy all / Export CSV.
      if (catalogNames.has(name)) continue;
      catalogNames.add(name);
      out.push({
        id: s.id,
        name,
        pick_up_time: s.pick_up_time || null,
        drop_off_time: s.drop_off_time || null,
        address: (s.address ?? "").trim(),
        riders: ridersByStop.get(name) ?? [],
      });
    }
    for (const [name, riders] of [...ridersByStop.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      if (catalogNames.has(name)) continue;
      out.push({
        id: null,
        name,
        pick_up_time: null,
        drop_off_time: null,
        address: "",
        riders,
      });
    }

    return NextResponse.json({
      stops: out,
      totalRiders: [...ridersByStop.values()].reduce(
        (n, l) => n + l.length,
        0
      ),
    } satisfies BusStopsResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface BusStopRider {
  student_id: number;
  student_name: string;
  grade: string;
  family_id: number;
  family_name: string;
  parent_name: string;
  parent_phone: string;
}

export interface BusStopGroup {
  /** Catalog row id, or null for a synthetic group (riders whose
   *  stop name no longer matches the catalog, or no stop picked). */
  id: number | null;
  name: string;
  /** Unix ms, null when unset (the calendar 0-sentinel convention). */
  pick_up_time: number | null;
  drop_off_time: number | null;
  address: string;
  riders: BusStopRider[];
}

export interface BusStopsResponse {
  stops: BusStopGroup[];
  totalRiders: number;
}
