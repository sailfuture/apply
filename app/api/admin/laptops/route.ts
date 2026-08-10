import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoLaptopAssignment, type XanoStudent } from "@/lib/xano";

/**
 * Laptop inventory — the admin management surface for the ops-group
 * `laptops` / `laptop_assignments` tables. The page owns the full
 * device lifecycle now (create, edit, RFID tags, deactivate,
 * assign/return, delete); the staff-side RFID check-in system reads
 * the same tables.
 *
 *   GET  ?yearId=  → { laptops, students } — every device with its
 *     open assignment + past history, plus the enrolled-student
 *     roster for the assign picker (crew comes from the year's
 *     registration packet; yearId falls back to the active year).
 *   POST → create a device (asset/serial/model required).
 *
 * Assignments created here always stamp the enrolled bridge columns
 * (`enrolled_students_id`/`enrolled_families_id`) so the parent
 * Store page keeps showing families their checked-out devices.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = Number(req.nextUrl.searchParams.get("yearId"));

    const [devicesR, assignmentsR, studentsR, yearsR] =
      await Promise.allSettled([
        xano.laptops.getAll(),
        xano.laptopAssignments.getAll(),
        xano.students.getAll(),
        xano.schoolYears.getAll(),
      ]);
    for (const [label, r] of [
      ["devices", devicesR],
      ["assignments", assignmentsR],
      ["students", studentsR],
      ["years", yearsR],
    ] as const) {
      if (r.status === "rejected") {
        console.error(`[/api/admin/laptops] ${label} unavailable:`, r.reason);
      }
    }
    const devices = devicesR.status === "fulfilled" ? devicesR.value : [];
    const assignments =
      assignmentsR.status === "fulfilled" ? assignmentsR.value : [];
    const students = studentsR.status === "fulfilled" ? studentsR.value : [];
    const years = yearsR.status === "fulfilled" ? yearsR.value : [];

    // Crew placements live on the year's registration packet. Use the
    // requested year (top-nav picker) or fall back to the active one.
    const yearId =
      Number.isFinite(yearIdParam) && yearIdParam > 0
        ? yearIdParam
        : years.find((y) => y.isActive)?.id ?? 0;
    const packets = yearId
      ? await xano.studentRegistration.getByYear(yearId).catch((err) => {
          console.error("[/api/admin/laptops] packets unavailable:", err);
          return [];
        })
      : [];
    const crewByStudent = new Map<number, string>();
    for (const p of packets) {
      const crew = (p.crew_assignment ?? "").trim();
      if (crew) crewByStudent.set(Number(p.registration_students_id), crew);
    }

    const studentById = new Map(students.map((s) => [s.id, s]));
    const shapeAssignment = (a: XanoLaptopAssignment): LaptopAssignmentInfo => {
      const student = studentById.get(Number(a.enrolled_students_id));
      return {
        id: a.id,
        laptops_id: Number(a.laptops_id) || 0,
        enrolled_students_id: Number(a.enrolled_students_id) || 0,
        student_name: student
          ? `${student.first_name} ${student.last_name}`.trim()
          : "",
        student_photo_url: resolvePhotoUrl(student?.student_photo),
        crew: student ? crewByStudent.get(student.id) ?? "" : "",
        assigned_date: a.assigned_date ?? 0,
        assigned_condition: (a.assigned_condition ?? "").trim(),
        returned_date: a.returned_date ?? 0,
        returned_condition: (a.returned_condition ?? "").trim(),
        notes: (a.notes ?? "").trim(),
      };
    };

    const byDevice = new Map<number, XanoLaptopAssignment[]>();
    for (const a of assignments) {
      const key = Number(a.laptops_id) || 0;
      const list = byDevice.get(key);
      if (list) list.push(a);
      else byDevice.set(key, [a]);
    }

    const laptops: AdminLaptopDevice[] = devices
      .map((d) => {
        const rows = (byDevice.get(d.id) ?? [])
          .slice()
          .sort((a, b) => (b.assigned_date ?? 0) - (a.assigned_date ?? 0));
        // Open checkout (no returned_date) = the current holder. Any
        // extra open rows are legacy glitches — surfaced in history so
        // they stay visible rather than silently dropped.
        const openIdx = rows.findIndex((r) => !r.returned_date);
        const current = openIdx >= 0 ? shapeAssignment(rows[openIdx]) : null;
        const history = rows
          .filter((_, i) => i !== openIdx)
          .map(shapeAssignment);
        return {
          id: d.id,
          asset_number: (d.asset_number ?? "").trim(),
          serial_number: (d.serial_number ?? "").trim(),
          model: (d.model ?? "").trim(),
          year_purchase: (d.year_purchase ?? "").trim(),
          device_management_url: (d.device_management_url ?? "").trim(),
          rfid_uid: Array.isArray(d.rfid_uid)
            ? d.rfid_uid.filter((u): u is string => typeof u === "string" && !!u)
            : [],
          deactivated: d.isArchived === true,
          reason_for_archive: (d.reason_for_archive ?? "").trim(),
          current,
          history,
        };
      })
      // Natural sort on asset number ("1-01", "1-02" … "10-01").
      .sort((a, b) =>
        a.asset_number.localeCompare(b.asset_number, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );

    const openDeviceByStudent = new Map<number, string>();
    for (const l of laptops) {
      if (l.current?.enrolled_students_id) {
        openDeviceByStudent.set(
          l.current.enrolled_students_id,
          l.asset_number || l.model || `#${l.id}`
        );
      }
    }

    const roster: LaptopStudentOption[] = students
      .filter((s) => s.isEnrolled === true && s.isArchived !== true)
      .map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`.trim() || `Student #${s.id}`,
        crew: crewByStudent.get(s.id) ?? "",
        photo_url: resolvePhotoUrl(s.student_photo),
        assigned_asset: openDeviceByStudent.get(s.id) ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ laptops, students: roster });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Create a device. Asset number, serial number, and model are
 *  required; asset + serial are uniqueness-checked against the
 *  existing inventory so a fat-fingered duplicate is caught here
 *  instead of confusing the RFID scanner later. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const asset_number = str(b.asset_number);
    const serial_number = str(b.serial_number);
    const model = str(b.model);
    if (!asset_number || !serial_number || !model) {
      return NextResponse.json(
        { error: "Asset number, serial number, and model are required" },
        { status: 400 }
      );
    }

    const existing = await xano.laptops.getAll();
    const assetTaken = existing.some(
      (d) =>
        (d.asset_number ?? "").trim().toLowerCase() ===
        asset_number.toLowerCase()
    );
    if (assetTaken) {
      return NextResponse.json(
        { error: `Asset number "${asset_number}" already exists` },
        { status: 409 }
      );
    }
    const serialTaken = existing.some(
      (d) =>
        (d.serial_number ?? "").trim().toLowerCase() ===
        serial_number.toLowerCase()
    );
    if (serialTaken) {
      return NextResponse.json(
        { error: `Serial number "${serial_number}" already exists` },
        { status: 409 }
      );
    }

    const created = await xano.laptops.create({
      asset_number,
      serial_number,
      model,
      year_purchase: str(b.year_purchase),
      device_management_url: str(b.device_management_url),
      rfid_uid: [],
      isArchived: false,
      reason_for_archive: "",
    });
    return NextResponse.json(created);
  } catch (err) {
    return handleAdminError(err);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Pick a fetchable URL out of the Xano image-metadata blob on
 *  `student_photo` — `url` when present, else the public Xano base +
 *  `path`. Same derivation as the Toddle-sync route. */
function resolvePhotoUrl(
  photo: XanoStudent["student_photo"] | undefined
): string | null {
  if (!photo || typeof photo !== "object") return null;
  const url = (photo as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (photo as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/** One checkout row (open or closed), joined to the enrolled
 *  student. `student_name` is "" for legacy staff-system rows that
 *  were never linked to an enrolled student. */
export interface LaptopAssignmentInfo {
  id: number;
  laptops_id: number;
  /** 0 = not linked to an enrolled student. */
  enrolled_students_id: number;
  student_name: string;
  student_photo_url: string | null;
  /** Crew placement from the year's packet ("Crew A"–"Crew E"). */
  crew: string;
  /** Unix ms; 0 = unknown. */
  assigned_date: number;
  /** Letter grade at pickup ("A"…). */
  assigned_condition: string;
  /** Unix ms; 0 = still checked out. */
  returned_date: number;
  returned_condition: string;
  notes: string;
}

/** One device with its assignment state, shaped for the admin page. */
export interface AdminLaptopDevice {
  id: number;
  asset_number: string;
  serial_number: string;
  model: string;
  year_purchase: string;
  device_management_url: string;
  rfid_uid: string[];
  /** `isArchived` on the Xano row — the "Deactivated" toggle. */
  deactivated: boolean;
  reason_for_archive: string;
  /** Open checkout, or null when the device is on the shelf. */
  current: LaptopAssignmentInfo | null;
  /** Closed checkouts, newest first. */
  history: LaptopAssignmentInfo[];
}

/** Enrolled student in the assign picker. `assigned_asset` names the
 *  device they already hold ("" = free) so the picker can disable
 *  them against double-issuing. */
export interface LaptopStudentOption {
  id: number;
  name: string;
  crew: string;
  photo_url: string | null;
  assigned_asset: string;
}

export interface AdminLaptopsResponse {
  laptops: AdminLaptopDevice[];
  students: LaptopStudentOption[];
}
