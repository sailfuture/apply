import { createSign } from "crypto";
import { stripNameSuffix } from "@/lib/name-suffix";
import { APOSTROPHE_VARIANTS } from "@/lib/search-text";

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
 *   1. ensure `/SailFuture Academy/Student/<Student Name>` exists
 *      (Directory API) — the same OU the student's own Workspace
 *      account is placed in, via `resolveStudentOuPath`
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
 *   - GOOGLE_STUDENT_OU            — optional OU that holds the
 *     per-student OUs (default "/SailFuture Academy/Student",
 *     verified against the live tree)
 *   - GOOGLE_SENIOR_OU             — optional OU that holds the
 *     seniors' per-student OUs (default "/SailFuture Academy/Seniors",
 *     also verified live). A student's account is moved there by hand
 *     from the School Account card; everything else follows the
 *     account — see `resolveStudentOuPathForAccount`
 *   - GOOGLE_DEVICE_OU_PARENT      — optional override for where
 *     devices park; defaults to GOOGLE_STUDENT_OU so a student and
 *     their Chromebook share one OU
 *   - GOOGLE_DEVICE_EXTRA_ALLOWLIST — optional comma-separated staff
 *     emails always included in every device allowlist so IT can
 *     still sign in
 *
 * The service account's domain-wide delegation entry must authorize
 * every scope in SCOPES below. Unset env degrades gracefully —
 * callers check `isGoogleAdminConfigured()` and skip, same contract
 * as the calendar layer.
 *
 * This module also creates student Workspace accounts for the School
 * Account card (see `createWorkspaceUser`) and sets / clears their
 * profile photo from the admin-uploaded student headshot (see
 * `setWorkspaceUserPhoto`), which is why the user scope is in the
 * list.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.device.chromeos",
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy",
  // Creating the student's Workspace account from the School Account
  // card. Adding a scope here means re-authorizing the service
  // account's client ID in the Workspace admin console — the existing
  // grant does NOT widen on its own.
  "https://www.googleapis.com/auth/admin.directory.user",
].join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_BASE = "https://admin.googleapis.com/admin/directory/v1";
const POLICY_BASE = "https://chromepolicy.googleapis.com/v1";
const SIGNIN_SCHEMA = "chrome.devices.SignInRestriction";
/**
 * The schema's own name for "only the allowlist may sign in", read
 * off `policySchemas/chrome.devices.SignInRestriction` — the enum is
 * RESTRICTED_LIST / ANY_USER / NO_USERS, each carrying this prefix.
 *
 * This module used to write and compare the bare "RESTRICTED_LIST".
 * The compare never matched what Google returns, so every org unit
 * read as unrestricted — including the 245 that were. Writes now use
 * the schema's exact value; reads accept either spelling.
 */
const SIGNIN_RESTRICTED = "ALLOW_NEW_USERS_ENUM_RESTRICTED_LIST";

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
 *  parked here. Defaults to the student OU rather than a separate
 *  tree: a device restricted to one student has to sit in the SAME
 *  per-student OU as that student's account for the sign-in policy to
 *  mean anything. (The old "/Students" default doesn't exist in the
 *  domain — `ensureOrgUnit` would have created a stray one at the
 *  root.) `GOOGLE_DEVICE_OU_PARENT` still overrides. */
export function deviceOuParent(): string {
  const raw = (process.env.GOOGLE_DEVICE_OU_PARENT ?? "").trim();
  if (!raw) return studentOuPath();
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * OU that newly created student accounts are placed in.
 *
 * Default verified live against the Workspace tree: the org's student
 * OU is `/SailFuture Academy/Student` — singular, and nested under the
 * "SailFuture Academy" OU rather than sitting at the root. Existing
 * student accounts are in it (some in a per-student child OU beneath
 * it, which is the Chromebook sign-in restriction's doing).
 *
 * Without this, `createWorkspaceUser` defaulted to "/" and every
 * account we made landed in the root OU — outside whatever policy the
 * student OU carries. Override with `GOOGLE_STUDENT_OU` if the tree
 * is ever renamed; normalized to a leading slash, no trailing slash.
 */
export function studentOuPath(): string {
  const raw = (process.env.GOOGLE_STUDENT_OU ?? "").trim();
  const path = raw || "/SailFuture Academy/Student";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * The OU for ONE student — their own child OU under the student OU,
 * e.g. "/SailFuture Academy/Student/Craig Mebane Jr.".
 *
 * `chrome.devices.SignInRestriction` is a DEVICE policy: it is set on
 * the OU the Chromebook sits in and names which accounts may sign in
 * there. So it is the DEVICE's placement that enforces anything — the
 * student's own account living in the same OU is organisational, not
 * load-bearing.
 *
 * What matters here is that both sides agree on the path. Account
 * creation and the laptop restriction build it through this one
 * helper because two spellings would silently become two OUs, and the
 * policy would end up on the one the device isn't in.
 *
 * Suffix-free, matching the email and the Toddle push. Synchronous,
 * so it names where a student's OU WOULD go — use
 * `resolveStudentOuPath` before creating or moving anything, since an
 * OU may already exist under the other spelling.
 */
export function studentOuPathFor(
  displayName: string,
  parent: string = studentOuPath()
): string {
  const name = studentOuName(stripNameSuffix(displayName));
  return name ? `${parent}/${name}` : parent;
}

/**
 * OU that holds the SENIORS' per-student OUs — a second tree beside
 * the student one, with the same shape: one child OU per student,
 * named after them, carrying that student's sign-in restriction.
 *
 * Default verified live: `/SailFuture Academy/Seniors` exists and was
 * built by hand, with the senior accounts parked directly in it and
 * their Chromebooks in the per-student children. Override with
 * `GOOGLE_SENIOR_OU`; normalized like `studentOuPath`.
 */
export function seniorOuPath(): string {
  const raw = (process.env.GOOGLE_SENIOR_OU ?? "").trim();
  const path = raw || "/SailFuture Academy/Seniors";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function sameOuPath(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True when `path` is `parent` itself or anything beneath it. */
export function isAtOrUnderOu(path: string, parent: string): boolean {
  const p = path.trim().toLowerCase();
  const root = parent.trim().toLowerCase();
  return p === root || p.startsWith(`${root}/`);
}

/**
 * True when `path` is a per-student OU — strictly beneath one of the
 * parents this app files students under (student, seniors, or the
 * device-park override).
 *
 * This is what "a device we manage" means. It used to be "beneath the
 * student OU", which stopped being true the moment a senior's
 * Chromebook sat in the Seniors tree: returning that laptop skipped
 * the park step as "not ours" and left it locked to the student who
 * had just handed it in.
 */
export function isPerStudentOu(path: string): boolean {
  return [deviceOuParent(), studentOuPath(), seniorOuPath()].some(
    (parent) => isAtOrUnderOu(path, parent) && !sameOuPath(path, parent)
  );
}

/**
 * Which tree a student belongs in, read off where their ACCOUNT is.
 *
 * Seniors aren't flagged anywhere in our data — an admin moves the
 * account into the Seniors tree by hand, and that placement is the
 * record. Reading it back from Google (rather than storing a second
 * copy that could disagree) is what keeps the account, the sign-in
 * policy and the Chromebook on one path.
 *
 * An account sitting directly in the Seniors OU counts: that is how
 * the hand-built tree holds them.
 */
export function studentOuParentForAccount(
  accountOuPath: string | null | undefined
): string {
  return accountOuPath && isAtOrUnderOu(accountOuPath, seniorOuPath())
    ? seniorOuPath()
    : studentOuPath();
}

/** The form two OU names are compared in: case, runs of spaces and
 *  apostrophe look-alikes don't make a different student. */
function foldOuName(name: string): string {
  return name
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The student's OU path, preferring one that ALREADY exists.
 *
 * The tree was built by hand and isn't consistent about suffixes —
 * "Craig Mebane Jr." has one, "Steven Petros" doesn't, and both are
 * the same convention as far as anyone using the console is
 * concerned. Picking a spelling blindly would create a second OU
 * beside the student's existing one and strand whatever device
 * restriction is attached to the first.
 *
 * So: check both spellings, reuse whichever is already there, and
 * only when neither exists fall back to creating the suffix-free
 * name. New students converge on one rule; existing ones are left
 * where they are.
 *
 * "Already there" is looser than an exact path. The hand-built OUs
 * also differ from our stored names by a curly apostrophe
 * ("La’Mya Fulwood") or a doubled space ("Kamya  Green"), and an
 * exact lookup misses both — so when it does, the parent's children
 * are listed once and matched on the folded name.
 *
 * `parent` picks the tree (student by default, seniors when asked).
 * `prefer` is the OU the account sits in now: when that is already
 * one of this student's own, it wins outright, so a student is never
 * shuffled between two spellings of themselves.
 *
 * `children` is the parent's child list when the caller already has
 * it (a bulk run lists it once): the same exact-then-folded match is
 * then done in memory, with no lookups per student.
 */
export async function resolveStudentOuPath(
  displayName: string,
  opts: {
    parent?: string;
    prefer?: string | null;
    children?: Array<{ name: string; orgUnitPath: string }>;
  } = {}
): Promise<string> {
  const parent = opts.parent ?? studentOuPath();
  const names = [
    studentOuName(stripNameSuffix(displayName)),
    studentOuName(displayName),
  ].filter((n, i, all) => n && all.indexOf(n) === i);
  if (names.length === 0) return parent;
  const folded = new Set(names.map(foldOuName));

  const prefer = (opts.prefer ?? "").trim();
  if (
    prefer &&
    isAtOrUnderOu(prefer, parent) &&
    !sameOuPath(prefer, parent) &&
    // Direct children only — a deeper path isn't a per-student OU.
    !prefer.slice(parent.length + 1).includes("/") &&
    folded.has(foldOuName(prefer.slice(parent.length + 1)))
  ) {
    return prefer;
  }

  if (opts.children) {
    const exact = names
      .map((name) => opts.children?.find((ou) => ou.name === name))
      .find(Boolean);
    const match =
      exact ?? opts.children.find((ou) => folded.has(foldOuName(ou.name)));
    return match?.orgUnitPath ?? `${parent}/${names[0]}`;
  }

  for (const name of names) {
    const path = `${parent}/${name}`;
    if (await getOrgUnit(path).catch(() => null)) return path;
  }

  const siblings = await listChildOrgUnits(parent).catch(() => []);
  const match = siblings.find((ou) => folded.has(foldOuName(ou.name)));
  if (match) return match.orgUnitPath;

  return `${parent}/${names[0]}`;
}

/**
 * The student's OU path in whichever tree their account is in — the
 * one every caller that PLACES something should use.
 *
 * The laptop restriction used to resolve by name alone, always under
 * the student OU. For a senior that put the policy and the Chromebook
 * in `/…/Student/<Name>` while the account sat in `/…/Seniors`.
 *
 * A missing account (not created yet) resolves in the student tree,
 * which is where it will be created. A FAILED lookup throws rather
 * than guessing: guessing "student" would quietly move a senior's
 * laptop into the wrong tree.
 */
export async function resolveStudentOuPathForAccount(
  displayName: string,
  email: string
): Promise<string> {
  const user = email.trim() ? await getWorkspaceUser(email) : null;
  return resolveStudentOuPath(displayName, {
    parent: studentOuParentForAccount(user?.orgUnitPath),
    prefer: user?.orgUnitPath,
  });
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

/** The OUs directly inside `parent`, with their display names. One
 *  call returns them all — the Directory API doesn't page this list. */
export async function listChildOrgUnits(
  parent: string
): Promise<Array<OrgUnit & { name: string }>> {
  const res = await googleFetch(
    `${DIRECTORY_BASE}/customer/my_customer/orgunits?` +
      new URLSearchParams({ orgUnitPath: parent, type: "children" })
  );
  if (!res.ok) await fail(res, `Org unit list (${parent})`);
  const data = await res.json();
  const units: Record<string, unknown>[] = Array.isArray(
    data?.organizationUnits
  )
    ? data.organizationUnits
    : [];
  return units.map((u) => ({
    orgUnitId: String(u.orgUnitId ?? ""),
    orgUnitPath: String(u.orgUnitPath ?? ""),
    name: String(u.name ?? ""),
  }));
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
  /** True when the OU's effective policy is the restricted list. */
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
    restricted:
      typeof value?.deviceAllowNewUsers === "string" &&
      value.deviceAllowNewUsers.endsWith("RESTRICTED_LIST"),
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
                deviceAllowNewUsers: SIGNIN_RESTRICTED,
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

/* ───────────────────────── Workspace accounts ───────────────────────── */

export interface WorkspaceUser {
  primaryEmail: string;
  fullName: string;
  suspended: boolean;
  orgUnitPath: string;
  /** True until the student signs in and sets their own password. */
  changePasswordAtNextLogin: boolean;
  /** True when the account already has a profile photo — whether this
   *  app set it or the student did. Google only includes
   *  `thumbnailPhotoUrl` on users that have one. */
  hasPhoto: boolean;
}

function toWorkspaceUser(u: Record<string, unknown>): WorkspaceUser {
  const name = (u.name ?? {}) as Record<string, unknown>;
  return {
    primaryEmail: String(u.primaryEmail ?? ""),
    fullName: String(name.fullName ?? ""),
    suspended: u.suspended === true,
    orgUnitPath: String(u.orgUnitPath ?? ""),
    changePasswordAtNextLogin: u.changePasswordAtNextLogin === true,
    hasPhoto:
      typeof u.thumbnailPhotoUrl === "string" && u.thumbnailPhotoUrl.length > 0,
  };
}

/**
 * Look up a Workspace account by address. Returns null on 404 — a
 * missing account is the normal "not created yet" answer, not a
 * failure. Every other non-ok status still throws, so a permissions
 * problem can't masquerade as "no account".
 */
export async function getWorkspaceUser(
  email: string
): Promise<WorkspaceUser | null> {
  const addr = email.trim().toLowerCase();
  if (!addr) return null;
  const res = await googleFetch(
    `${DIRECTORY_BASE}/users/${encodeURIComponent(addr)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, "Workspace user lookup");
  return toWorkspaceUser(await res.json());
}

/**
 * Create the student's Workspace account at the exact address and
 * password the School Account card generated, so what admin sees in
 * the app is what actually works at the login screen.
 *
 * `changePasswordAtNextLogin` is deliberately FALSE: the generated
 * password is handed to the student as their working credential and
 * the card keeps displaying it. Forcing a reset at first login would
 * make the password on screen wrong the moment it's used.
 *
 * Caller must check `getWorkspaceUser` first — Google answers a
 * duplicate address with a 409 that this surfaces verbatim rather
 * than treating as success.
 */
export async function createWorkspaceUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  orgUnitPath?: string;
}): Promise<WorkspaceUser> {
  const res = await googleFetch(`${DIRECTORY_BASE}/users`, {
    method: "POST",
    body: JSON.stringify({
      primaryEmail: input.email.trim().toLowerCase(),
      name: {
        givenName: input.firstName.trim(),
        familyName: input.lastName.trim(),
      },
      password: input.password,
      changePasswordAtNextLogin: false,
      orgUnitPath: input.orgUnitPath?.trim() || "/",
    }),
  });
  if (!res.ok) await fail(res, "Workspace user create");
  return toWorkspaceUser(await res.json());
}

/**
 * Move an existing account into an org unit.
 *
 * For students already in Workspace before this app placed accounts —
 * they sit directly in the student OU with no per-student OU of their
 * own, so a device sign-in restriction has nothing to attach them to.
 * Only `orgUnitPath` is sent: a Directory PATCH merges, so the
 * password, name and everything else are untouched.
 */
export async function moveWorkspaceUserToOu(
  email: string,
  orgUnitPath: string
): Promise<WorkspaceUser> {
  const res = await googleFetch(
    `${DIRECTORY_BASE}/users/${encodeURIComponent(email.trim().toLowerCase())}`,
    { method: "PATCH", body: JSON.stringify({ orgUnitPath }) }
  );
  if (!res.ok) await fail(res, "Workspace user move");
  return toWorkspaceUser(await res.json());
}

function userPhotoUrl(email: string): string {
  return `${DIRECTORY_BASE}/users/${encodeURIComponent(
    email.trim().toLowerCase()
  )}/photos/thumbnail`;
}

/**
 * Set the account's profile photo — the picture Gmail, Meet, Classroom
 * and the Chromebook sign-in screen show for the student.
 *
 *   PUT users/{email}/photos/thumbnail  { photoData }
 *
 * `photoData` is "web-safe" base64. Google's own admin tooling sends
 * RFC 4648 base64url (`+`→`-`, `/`→`_`, `=` padding kept), so that goes
 * first; the reference doc instead spells padding as `*`, so a 400 on
 * the first attempt is retried in that form before giving up. No
 * mimeType is sent — Google sniffs the bytes, and the documented
 * values ("JPEG", "PNG", …) aren't real MIME strings. Whatever the
 * input size, Google stores its own downsized square thumbnail, so the
 * card's ~1000px compressed upload is plenty.
 */
export async function setWorkspaceUserPhoto(
  email: string,
  image: Buffer
): Promise<void> {
  const url = userPhotoUrl(email);
  const webSafe = image
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  let res = await googleFetch(url, {
    method: "PUT",
    body: JSON.stringify({ photoData: webSafe }),
  });
  if (res.status === 400) {
    res = await googleFetch(url, {
      method: "PUT",
      body: JSON.stringify({ photoData: webSafe.replace(/=/g, "*") }),
    });
  }
  if (!res.ok) await fail(res, "Workspace user photo update");
}

/**
 * Remove the account's profile photo (back to Google's initial-letter
 * avatar). A 404 means there was no photo to remove, which is the
 * state we wanted — callers confirm the ACCOUNT exists first, so a 404
 * here is never "no such user".
 */
export async function deleteWorkspaceUserPhoto(email: string): Promise<void> {
  const res = await googleFetch(userPhotoUrl(email), { method: "DELETE" });
  if (res.status === 404) return;
  if (!res.ok) await fail(res, "Workspace user photo delete");
}
