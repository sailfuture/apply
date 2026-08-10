import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  deviceOuParent,
  ensureOrgUnit,
  extraAllowlist,
  clearSignInRestriction,
  getChromeDeviceBySerial,
  getOrgUnit,
  getSignInRestriction,
  isGoogleAdminConfigured,
  moveChromeDeviceToOu,
  setSignInRestriction,
  studentOuName,
} from "@/lib/google-admin";

/**
 * Google Workspace sign-in restriction for one laptop — the bridge
 * between the inventory row (serial number) and the enrolled
 * ChromeOS device (see lib/google-admin.ts for the OU mechanics).
 *
 *   GET    → current state: is the integration configured, does an
 *            enrolled device match the serial, is it restricted, and
 *            to whom. Also reports the current holder's school email
 *            so the UI can label the restrict button.
 *   POST   → restrict the device to the current holder's school
 *            account (+ GOOGLE_DEVICE_EXTRA_ALLOWLIST staff): ensure
 *            the student's own OU (`/Students/<Name>`), apply the
 *            policy there, move the device in. Requires an open
 *            assignment linked to a student with a school_email.
 *   DELETE → lift the restriction: revert the student OU's policy to
 *            inherited and park the device in the parent OU. Student
 *            OUs are never deleted — they're school directory
 *            structure, not app scratch space.
 *
 * Restrict order is deliberate: policy first, move second — the
 * device never sits in its OU un-restricted. Policy changes reach
 * the login screen when the device next syncs (minutes, or after a
 * reboot), not instantly.
 */

export interface LaptopGoogleStatus {
  /** False = env not set; every other field is then moot. */
  configured: boolean;
  serial: string;
  /** Null = no enrolled ChromeOS device matches the serial. */
  device: {
    deviceId: string;
    orgUnitPath: string;
    status: string;
    recentUser: string;
  } | null;
  /** Effective sign-in restriction on the device's OU. */
  restricted: boolean;
  allowlist: string[];
  /** True when the device sits in a per-device OU we manage. */
  managed: boolean;
  /** Current holder's school Google account ("" = none usable). */
  studentEmail: string;
  studentName: string;
  /** Set when the integration is configured but Google (or Xano)
   *  couldn't be reached. The rest of the payload is still valid —
   *  the card shows this instead of silently spinning. */
  error?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await deviceId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    return NextResponse.json(await buildStatus(id));
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await deviceId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    if (!isGoogleAdminConfigured()) {
      return NextResponse.json(
        { error: "Google Admin integration is not configured" },
        { status: 503 }
      );
    }

    const laptop = await xano.laptops.getById(id).catch(() => null);
    if (!laptop) {
      return NextResponse.json(
        { error: `Laptop ${id} not found` },
        { status: 404 }
      );
    }
    const serial = (laptop.serial_number ?? "").trim();
    if (!serial) {
      return NextResponse.json(
        { error: "This laptop has no serial number" },
        { status: 400 }
      );
    }

    const holder = await currentHolder(id);
    if (!holder) {
      return NextResponse.json(
        { error: "Assign this laptop to a student first" },
        { status: 409 }
      );
    }
    if (!holder.email) {
      return NextResponse.json(
        {
          error: `${holder.name || "The assigned student"} has no school Google account yet — generate it from their enrolled-student page first`,
        },
        { status: 409 }
      );
    }

    const device = await getChromeDeviceBySerial(serial);
    if (!device) {
      return NextResponse.json(
        {
          error: `No enrolled ChromeOS device matches serial "${serial}" — is the device enrolled in the Workspace domain?`,
        },
        { status: 404 }
      );
    }

    // The student's own OU, by name; a blank name (shouldn't happen,
    // but names are editable) falls back to the account local-part.
    const ouName =
      studentOuName(holder.name) || holder.email.split("@")[0] || serial;
    const ouPath = `${deviceOuParent()}/${ouName}`;
    const ou = await ensureOrgUnit(ouPath);
    await setSignInRestriction(ou.orgUnitId, [
      holder.email,
      ...extraAllowlist().filter((e) => e !== holder.email),
    ]);
    if (device.orgUnitPath !== ou.orgUnitPath) {
      await moveChromeDeviceToOu(device.deviceId, ou.orgUnitPath);
    }

    return NextResponse.json(await buildStatus(id));
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await deviceId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    if (!isGoogleAdminConfigured()) {
      return NextResponse.json(
        { error: "Google Admin integration is not configured" },
        { status: 503 }
      );
    }

    const laptop = await xano.laptops.getById(id).catch(() => null);
    const serial = (laptop?.serial_number ?? "").trim();
    if (!laptop || !serial) {
      return NextResponse.json(
        { error: "Laptop or serial number not found" },
        { status: 404 }
      );
    }
    const device = await getChromeDeviceBySerial(serial);
    if (!device) {
      return NextResponse.json(
        { error: `No enrolled ChromeOS device matches serial "${serial}"` },
        { status: 404 }
      );
    }

    const parent = deviceOuParent();
    if (!device.orgUnitPath.startsWith(`${parent}/`)) {
      // Not in a per-device OU we manage — nothing to lift.
      return NextResponse.json(await buildStatus(id));
    }

    const ou = await getOrgUnit(device.orgUnitPath);
    if (ou) await clearSignInRestriction(ou.orgUnitId);
    await ensureOrgUnit(parent);
    await moveChromeDeviceToOu(device.deviceId, parent);

    return NextResponse.json(await buildStatus(id));
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Open assignment's linked student, with their school account. */
async function currentHolder(
  laptopId: number
): Promise<{ name: string; email: string } | null> {
  const assignments = await xano.laptopAssignments.getAll();
  const open = assignments.find(
    (a) => Number(a.laptops_id) === laptopId && !a.returned_date
  );
  const studentId = Number(open?.enrolled_students_id) || 0;
  if (!studentId) return null;
  const student = await xano.students.getById(studentId).catch(() => null);
  if (!student) return null;
  return {
    name: `${student.first_name} ${student.last_name}`.trim(),
    email: (student.school_email ?? "").trim().toLowerCase(),
  };
}

/**
 * Read-only status probe. Every external call is caught: this backs a
 * panel that should always render *something*, and a Google outage or
 * an un-granted delegation scope used to escape as a bare 500, which
 * left the card spinning on "Checking Google Admin…" with nothing but
 * a console error to go on.
 */
async function buildStatus(laptopId: number): Promise<LaptopGoogleStatus> {
  const laptop = await xano.laptops.getById(laptopId).catch(() => null);
  const serial = (laptop?.serial_number ?? "").trim();
  const holder = await currentHolder(laptopId).catch((err) => {
    console.error(
      `[/api/admin/laptops/${laptopId}/google] holder lookup failed:`,
      err
    );
    return null;
  });

  const base: LaptopGoogleStatus = {
    configured: isGoogleAdminConfigured(),
    serial,
    device: null,
    restricted: false,
    allowlist: [],
    managed: false,
    studentEmail: holder?.email ?? "",
    studentName: holder?.name ?? "",
  };
  if (!base.configured || !serial) return base;

  try {
    const device = await getChromeDeviceBySerial(serial);
    if (!device) return base;
    base.device = {
      deviceId: device.deviceId,
      orgUnitPath: device.orgUnitPath,
      status: device.status,
      recentUser: device.recentUser,
    };
    base.managed = device.orgUnitPath.startsWith(`${deviceOuParent()}/`);

    const ou = await getOrgUnit(device.orgUnitPath).catch(() => null);
    if (ou) {
      const policy = await getSignInRestriction(ou.orgUnitId).catch(() => null);
      if (policy) {
        base.restricted = policy.restricted;
        base.allowlist = policy.allowlist;
      }
    }
  } catch (err) {
    console.error(
      `[/api/admin/laptops/${laptopId}/google] Google lookup failed:`,
      err
    );
    base.error = googleErrorHint(err);
  }
  return base;
}

/**
 * Turn a raw Google failure into something an admin can act on. The
 * two that actually happen are worth naming explicitly: the service
 * account exists but the domain hasn't authorized its scopes
 * (`unauthorized_client`), and the impersonated user isn't a real
 * super-admin.
 */
function googleErrorHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unauthorized_client|invalid_grant/i.test(msg)) {
    return (
      "Google rejected the service account. In the Workspace admin console, " +
      "authorize its client ID for the Chrome device, org unit, customer, " +
      "and Chrome policy scopes (Security → API controls → Domain-wide " +
      "delegation), and confirm GOOGLE_ADMIN_IMPERSONATE is a super-admin."
    );
  }
  if (/\b40[13]\b|permission|forbidden/i.test(msg)) {
    return `Google denied the request — check the impersonated admin's privileges. (${msg})`;
  }
  return `Couldn't reach Google Admin: ${msg}`;
}

async function deviceId(
  params: Promise<{ id: string }>
): Promise<number | null> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  return Number.isFinite(id) && id > 0 ? id : null;
}
