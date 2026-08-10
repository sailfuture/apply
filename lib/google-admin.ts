import { createSign } from "crypto";

/**
 * Google Workspace admin client for Chromebook sign-in restriction —
 * locks an enrolled ChromeOS device so only its assigned student's
 * school account (plus optional IT accounts) can sign in.
 *
 * Why org units are involved at all: "Sign-in restriction" is a
 * DEVICE policy in Google's model, and device policies apply to org
 * units, never to individual devices. The school's convention is one
 * OU per student, named after them, inside the Students OU — the
 * student's Chromebook lives in their OU. So restricting a device:
 *
 *   1. ensure `/Students/<Student Name>` exists (Directory API)
 *   2. apply chrome.devices.SignInRestriction to that OU with the
 *      student's school email as the allowlist (Chrome Policy API)
 *   3. move the device into the OU (Directory API, by serial number)
 *
 * Un-restricting reverts the OU's policy to inherited and parks the
 * device back in the parent Students OU. Student OUs are treated as
 * part of the school's directory structure: the app creates them
 * when missing but NEVER deletes them — they may also hold the
 * student's user account or hand-managed settings.
 *
 * Auth reuses the calendar service account (same signed-JWT flow as
 * lib/google-calendar.ts) but with its own impersonation target and
 * token cache: the Admin SDK requires acting as a SUPER ADMIN, not
 * the regular staff user the calendar impersonates.
 *
 * Env (first two shared with the calendar integration):
 *   - GOOGLE_CALENDAR_CLIENT_EMAIL — service account's client_email
 *   - GOOGLE_CALENDAR_PRIVATE_KEY  — service account's private_key
 *   - GOOGLE_ADMIN_IMPERSONATE     — a super-admin workspace user
 *   - GOOGLE_DEVICE_OU_PARENT      — optional OU that holds the
 *     per-student OUs (default "/Students"); un-restricted devices
 *     are parked here
 *   - GOOGLE_DEVICE_EXTRA_ALLOWLIST — optional comma-separated staff
 *     emails always included in every device allowlist so IT can
 *     still sign in
 *
 * The service account's domain-wide delegation entry must authorize
 * the four SCOPES below. Unset env degrades gracefully — callers
 * check `isGoogleAdminConfigured()` and skip, same contract as the
 * calendar layer.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.device.chromeos",
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy",
].join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_BASE = "https://admin.googleapis.com/admin/directory/v1";
const POLICY_BASE = "https://chromepolicy.googleapis.com/v1";
const SIGNIN_SCHEMA = "chrome.devices.SignInRestriction";

function cleanEmail(v: string): string {
  return v.trim().split(/\s+/)[0] ?? "";
}

function getConfig(): {
  clientEmail: string;
  privateKey: string;
  impersonate: string;
} | null {
  const clientEmail = cleanEmail(process.env.GOOGLE_CALENDAR_CLIENT_EMAIL ?? "");
  const rawKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
  const impersonate = cleanEmail(process.env.GOOGLE_ADMIN_IMPERSONATE ?? "");
  if (!clientEmail || !rawKey || !impersonate) return null;
  return {
    clientEmail,
    privateKey: rawKey.replace(/\\n/g, "\n"),
    impersonate,
  };
}

export function isGoogleAdminConfigured(): boolean {
  return getConfig() !== null;
}

/** OU every per-student OU lives under; un-restricted devices are
 *  parked here. Normalized to a leading slash, no trailing slash. */
export function deviceOuParent(): string {
  const raw = (process.env.GOOGLE_DEVICE_OU_PARENT ?? "").trim();
  const path = raw || "/Students";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

/** Staff emails included in every device allowlist. */
export function extraAllowlist(): string[] {
  return (process.env.GOOGLE_DEVICE_EXTRA_ALLOWLIST ?? "")
    .split(",")
    .map((e) => cleanEmail(e))
    .filter(Boolean);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("Google Admin is not configured");
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: config.clientEmail,
      sub: config.impersonate,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    })
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(config.privateKey);
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${await res.text()}`
    );
  }
  const data = await res.json();
  if (!data?.access_token) {
    throw new Error("Google token exchange returned no access_token");
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function fail(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  // Google error payloads bury the useful sentence at
  // error.message — surface it when parseable.
  let detail = body;
  try {
    detail = JSON.parse(body)?.error?.message ?? body;
  } catch {
    /* keep raw body */
  }
  throw new Error(`${what} failed (${res.status}): ${detail}`);
}

// The Chrome Policy API addresses the customer by real id (no
// `my_customer` alias like the Directory API) — resolve once.
let cachedCustomerId: string | null = null;

async function getCustomerId(): Promise<string> {
  if (cachedCustomerId) return cachedCustomerId;
  const res = await googleFetch(`${DIRECTORY_BASE}/customers/my_customer`);
  if (!res.ok) await fail(res, "Customer lookup");
  const data = await res.json();
  if (typeof data?.id !== "string" || !data.id) {
    throw new Error("Customer lookup returned no id");
  }
  cachedCustomerId = data.id;
  return data.id;
}

export interface ChromeDevice {
  /** Directory API's immutable device id (NOT the serial). */
  deviceId: string;
  serialNumber: string;
  orgUnitPath: string;
  /** ACTIVE / DEPROVISIONED / DISABLED … */
  status: string;
  /** Most recent sign-in Google observed, if any. */
  recentUser: string;
}

/** Find the enrolled ChromeOS device with this serial number.
 *  Returns null when no device matches — i.e. the laptop isn't
 *  enrolled in the Workspace domain (or the serial is wrong). */
export async function getChromeDeviceBySerial(
  serial: string
): Promise<ChromeDevice | null> {
  const q = serial.trim();
  if (!q) return null;
  const res = await googleFetch(
    `${DIRECTORY_BASE}/customer/my_customer/devices/chromeos?` +
      new URLSearchParams({
        query: `id:${q}`,
        projection: "FULL",
        maxResults: "10",
      })
  );
  if (!res.ok) await fail(res, "Chrome device lookup");
  const data = await res.json();
  const devices: Record<string, unknown>[] = Array.isArray(data?.chromeosdevices)
    ? data.chromeosdevices
    : [];
  // `id:` prefix-matches, so insist on the exact serial.
  const match = devices.find(
    (d) =>
      typeof d.serialNumber === "string" &&
      d.serialNumber.trim().toLowerCase() === q.toLowerCase()
  );
  if (!match) return null;
  const recent = Array.isArray(match.recentUsers)
    ? (match.recentUsers[0] as { email?: string } | undefined)
    : undefined;
  return {
    deviceId: String(match.deviceId ?? ""),
    serialNumber: String(match.serialNumber ?? ""),
    orgUnitPath: String(match.orgUnitPath ?? ""),
    status: String(match.status ?? ""),
    recentUser: recent?.email ?? "",
  };
}

export interface OrgUnit {
  /** "id:03abc…" from the Directory API. */
  orgUnitId: string;
  orgUnitPath: string;
}

/** Directory OU endpoints address the OU by path with the leading
 *  slash dropped and each segment encoded ("/A/B" → "A/B"). */
function ouUrlPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export async function getOrgUnit(path: string): Promise<OrgUnit | null> {
  const res = await googleFetch(
    `${DIRECTORY_BASE}/customer/my_customer/orgunits/${ouUrlPath(path)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, `Org unit lookup (${path})`);
  const data = await res.json();
  return {
    orgUnitId: String(data.orgUnitId ?? ""),
    orgUnitPath: String(data.orgUnitPath ?? path),
  };
}

/** Get-or-create an OU, creating missing ancestors as needed
 *  ("/Student Devices/1-01" creates both levels on first use). */
export async function ensureOrgUnit(path: string): Promise<OrgUnit> {
  const existing = await getOrgUnit(path);
  if (existing) return existing;

  const clean = `/${path.replace(/^\/+|\/+$/g, "")}`;
  const idx = clean.lastIndexOf("/");
  const parentPath = idx > 0 ? clean.slice(0, idx) : "/";
  const name = clean.slice(idx + 1);
  if (!name) throw new Error(`Invalid org unit path "${path}"`);
  if (parentPath !== "/") await ensureOrgUnit(parentPath);

  const res = await googleFetch(
    `${DIRECTORY_BASE}/customer/my_customer/orgunits`,
    {
      method: "POST",
      body: JSON.stringify({ name, parentOrgUnitPath: parentPath }),
    }
  );
  if (!res.ok) await fail(res, `Org unit create (${clean})`);
  const data = await res.json();
  return {
    orgUnitId: String(data.orgUnitId ?? ""),
    orgUnitPath: String(data.orgUnitPath ?? clean),
  };
}

export async function moveChromeDeviceToOu(
  deviceId: string,
  orgUnitPath: string
): Promise<void> {
  const res = await googleFetch(
    `${DIRECTORY_BASE}/customer/my_customer/devices/chromeos/moveDevicesToOu?` +
      new URLSearchParams({ orgUnitPath }),
    { method: "POST", body: JSON.stringify({ deviceIds: [deviceId] }) }
  );
  if (!res.ok) await fail(res, "Chrome device move");
}

/** targetResource wants "orgunits/03abc…" — the Directory id minus
 *  its "id:" prefix. */
function policyTarget(orgUnitId: string): { targetResource: string } {
  return { targetResource: `orgunits/${orgUnitId.replace(/^id:/, "")}` };
}

export interface SignInRestriction {
  /** True when the OU's effective policy is RESTRICTED_LIST. */
  restricted: boolean;
  allowlist: string[];
}

/** Read the OU's effective sign-in restriction (inherited or set). */
export async function getSignInRestriction(
  orgUnitId: string
): Promise<SignInRestriction> {
  const customer = await getCustomerId();
  const res = await googleFetch(
    `${POLICY_BASE}/customers/${customer}/policies:resolve`,
    {
      method: "POST",
      body: JSON.stringify({
        policySchemaFilter: SIGNIN_SCHEMA,
        policyTargetKey: policyTarget(orgUnitId),
      }),
    }
  );
  if (!res.ok) await fail(res, "Sign-in policy read");
  const data = await res.json();
  const value = Array.isArray(data?.resolvedPolicies)
    ? data.resolvedPolicies[0]?.value?.value
    : null;
  const allowlist = Array.isArray(value?.userAllowlist)
    ? value.userAllowlist.filter((e: unknown): e is string => typeof e === "string")
    : [];
  return {
    restricted: value?.deviceAllowNewUsers === "RESTRICTED_LIST",
    allowlist,
  };
}

/** Restrict sign-in on the OU to exactly these accounts. */
export async function setSignInRestriction(
  orgUnitId: string,
  allowlist: string[]
): Promise<void> {
  const customer = await getCustomerId();
  const res = await googleFetch(
    `${POLICY_BASE}/customers/${customer}/policies/orgunits:batchModify`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            policyTargetKey: policyTarget(orgUnitId),
            policyValue: {
              policySchema: SIGNIN_SCHEMA,
              value: {
                deviceAllowNewUsers: "RESTRICTED_LIST",
                userAllowlist: allowlist,
              },
            },
            updateMask: "deviceAllowNewUsers,userAllowlist",
          },
        ],
      }),
    }
  );
  if (!res.ok) await fail(res, "Sign-in policy apply");
}

/** Revert the OU's sign-in restriction to whatever it inherits. */
export async function clearSignInRestriction(orgUnitId: string): Promise<void> {
  const customer = await getCustomerId();
  const res = await googleFetch(
    `${POLICY_BASE}/customers/${customer}/policies/orgunits:batchInherit`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            policyTargetKey: policyTarget(orgUnitId),
            policySchema: SIGNIN_SCHEMA,
          },
        ],
      }),
    }
  );
  if (!res.ok) await fail(res, "Sign-in policy clear");
}

/** OU name for a student — their display name, with slashes swapped
 *  out (Google reads "/" as OU nesting) and whitespace collapsed.
 *  "Jane Smith" → OU "/Students/Jane Smith". */
export function studentOuName(name: string): string {
  const base = name.trim().replace(/\//g, "-").replace(/\s+/g, " ");
  return base.slice(0, 100);
}
