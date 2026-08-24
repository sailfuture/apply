import {
  deviceOuParent,
  ensureOrgUnit,
  extraAllowlist,
  getChromeDeviceBySerial,
  isGoogleAdminConfigured,
  moveChromeDeviceToOu,
  resolveStudentOuPath,
  setSignInRestriction,
  studentOuName,
} from "@/lib/google-admin";

/**
 * Putting a Chromebook in its student's org unit.
 *
 * `chrome.devices.SignInRestriction` is a DEVICE policy: it lives on
 * the OU the device sits in and names who may sign in there. So the
 * two halves — the policy and the device's placement — only mean
 * something together, and both have to happen in one step or the
 * device spends a window in an OU that doesn't restrict it. Policy
 * first, move second, for exactly that reason.
 *
 * This is shared by the explicit Restrict button on the laptop detail
 * sheet and by the assign/return flow, which does it automatically.
 * Two copies of this sequence would drift, and a drift here means a
 * device that looks locked and isn't.
 *
 * Preconditions come back as `skipped` rather than thrown: an assign
 * shouldn't fail because a student has no school account yet. Real
 * Google failures DO throw, so the explicit button can report them.
 */

export type LaptopOuResult =
  /** Policy applied and the device is in the student's OU. */
  | { status: "placed"; ouPath: string; allowlist: string[] }
  /** Device moved back to the shared park OU. */
  | { status: "parked"; ouPath: string }
  /** Nothing needed doing. */
  | { status: "unchanged"; ouPath: string }
  /** A precondition wasn't met. Not an error; usually not even wrong. */
  | { status: "skipped"; reason: SkipReason; detail: string };

export type SkipReason =
  | "not-configured"
  | "no-serial"
  | "no-school-email"
  | "device-not-found"
  | "not-managed";

function skip(reason: SkipReason, detail: string): LaptopOuResult {
  return { status: "skipped", reason, detail };
}

/**
 * Restrict a device to one student and move it into their OU.
 *
 * The OU is the student's own (`/SailFuture Academy/Student/<Name>`),
 * resolved through the same helper that places their Workspace
 * account, so account and device land in one place. A student whose
 * name gives no usable OU label falls back to their email local-part.
 */
export async function placeLaptopInStudentOu(input: {
  serial: string;
  studentName: string;
  studentEmail: string;
}): Promise<LaptopOuResult> {
  const serial = input.serial.trim();
  const email = input.studentEmail.trim().toLowerCase();

  if (!isGoogleAdminConfigured()) {
    return skip("not-configured", "Google Admin integration is not configured");
  }
  if (!serial) return skip("no-serial", "This laptop has no serial number");
  if (!email) {
    return skip(
      "no-school-email",
      `${input.studentName || "The assigned student"} has no school Google account yet`
    );
  }

  const device = await getChromeDeviceBySerial(serial);
  if (!device) {
    return skip(
      "device-not-found",
      `No enrolled ChromeOS device matches serial "${serial}"`
    );
  }

  const ouPath = studentOuName(input.studentName)
    ? await resolveStudentOuPath(input.studentName)
    : `${deviceOuParent()}/${email.split("@")[0] || serial}`;
  const ou = await ensureOrgUnit(ouPath);

  // Policy before move — the device must never sit in its OU
  // un-restricted, even briefly.
  const allowlist = [email, ...extraAllowlist().filter((e) => e !== email)];
  await setSignInRestriction(ou.orgUnitId, allowlist);

  if (device.orgUnitPath === ou.orgUnitPath) {
    return { status: "unchanged", ouPath: ou.orgUnitPath };
  }
  await moveChromeDeviceToOu(device.deviceId, ou.orgUnitPath);
  return { status: "placed", ouPath: ou.orgUnitPath, allowlist };
}

/**
 * Move a returned device out of its student's OU, back to the shared
 * park OU where it accepts anyone again.
 *
 * Deliberately does NOT clear the student OU's sign-in policy. That
 * OU also holds the student's own account and is armed when the
 * account is created; clearing it here would quietly un-arm the
 * student so that the NEXT device placed there restricts nobody. The
 * policy is harmless with no device in the OU, so it stays.
 */
export async function parkLaptop(serial: string): Promise<LaptopOuResult> {
  const clean = serial.trim();
  if (!isGoogleAdminConfigured()) {
    return skip("not-configured", "Google Admin integration is not configured");
  }
  if (!clean) return skip("no-serial", "This laptop has no serial number");

  const device = await getChromeDeviceBySerial(clean);
  if (!device) {
    return skip(
      "device-not-found",
      `No enrolled ChromeOS device matches serial "${clean}"`
    );
  }

  const parent = deviceOuParent();
  if (!device.orgUnitPath.startsWith(`${parent}/`)) {
    // Already parked, or somewhere we didn't put it — leave it be.
    return skip("not-managed", `Device is in ${device.orgUnitPath}`);
  }

  await ensureOrgUnit(parent);
  await moveChromeDeviceToOu(device.deviceId, parent);
  return { status: "parked", ouPath: parent };
}

/**
 * What the assign/return routes report back to the UI.
 *
 * Both call this best-effort: the checkout row is already written by
 * the time the Google work runs, so a policy failure must not turn a
 * successful assignment into an error response. The outcome rides
 * along in the payload and the dialog says what did or didn't land.
 */
export interface LaptopOuReport {
  ok: boolean;
  /** Human-readable, or "" when there's nothing worth saying. */
  message: string;
}

export async function reportLaptopOu(
  run: () => Promise<LaptopOuResult>,
  logLabel: string
): Promise<LaptopOuReport> {
  try {
    const result = await run();
    switch (result.status) {
      case "placed":
        return { ok: true, message: `Moved into ${result.ouPath}` };
      case "unchanged":
        return { ok: true, message: `Already in ${result.ouPath}` };
      case "parked":
        return { ok: true, message: `Returned to ${result.ouPath}` };
      case "skipped":
        // "Not configured" is the normal state on an install without
        // Google wired up — silent, not a warning.
        return {
          ok: result.reason === "not-configured",
          message: result.reason === "not-configured" ? "" : result.detail,
        };
    }
  } catch (err) {
    console.error(`${logLabel} Google org-unit step failed:`, err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Google Admin call failed",
    };
  }
}
