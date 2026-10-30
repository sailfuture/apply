import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { noteAuthMode } from "@/lib/xano-runtime";
import { NextResponse } from "next/server";
import { emailFromClaims } from "@/lib/family-auth";

/**
 * Admin authorization for `/admin/*` pages and `/api/admin/*` routes.
 *
 * Source of truth for who's an admin: Xano's `/teachers_by_admin` endpoint
 * (a different API group from the rest of the app's Xano client, hence
 * the dedicated base URL). It returns staff-with-admin-role records keyed
 * by email. We match the signed-in Clerk user's email against that list.
 *
 * The list changes rarely (maybe once a quarter when staff turn over), so
 * we cache it in-process for 5 minutes. Worst case after a staff change
 * is a 5-minute window where their access is stale — fine for now. We can
 * add a "Refresh admins" button later if it becomes a pain.
 */

const ADMIN_API_BASE =
  process.env.XANO_ADMIN_API_BASE_URL ??
  "https://xsc3-mvx7-r86m.n7e.xano.io/api:fJsHVIeC";

const ADMIN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Per-attempt cap on the admin-list fetch. Every admin route waits
 *  on this before it can read anything, so it must fail fast: the
 *  2026-10-30 traces showed the untimed version (3 tries + backoff)
 *  holding five routes for ~1.2 s and then 500-ing all of them. */
const ADMIN_FETCH_TIMEOUT_MS = 4_000;

/** Next Data Cache tag for the list — see `loadAdmins`. */
const ADMIN_LIST_TAG = "admin-list";

export interface AdminUser {
  /** Stable identifier — falls back to email when teacherId is empty. */
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: string;
  teacherId: string;
}

interface RawTeacher {
  firstName: string;
  lastName: string;
  email: string;
  teacherId: string;
  role: string;
  isArchived: boolean;
}

interface AdminCache {
  fetchedAt: number;
  byEmail: Map<string, AdminUser>;
}

let cache: AdminCache | null = null;
let inflight: Promise<AdminCache> | null = null;

async function loadAdmins(): Promise<AdminCache> {
  // Admin pages fan out 10–25 API calls at once and EVERY one runs
  // through this list, so a failure here takes a whole page down at
  // once. Three layers keep it up:
  //
  //   1. The Next Data Cache (`revalidate` = the TTL, tagged). On
  //      Vercel that cache is shared across function instances, so a
  //      freshly started instance's first request is a cache read,
  //      not a Xano round trip — the module-level copy below is per
  //      instance and starts empty on every cold start, which is
  //      exactly when the old `cache: "no-store"` fetch had nothing to
  //      fall back on. A failed background refresh keeps serving the
  //      last good copy.
  //   2. A hard per-attempt timeout, so a queueing Xano can't hold
  //      every admin route for seconds before failing them.
  //   3. The expired in-process copy, served when the fetch still
  //      can't complete: a staff roster that's minutes stale is
  //      strictly better than an admin surface that's down.
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      res = await fetch(`${ADMIN_API_BASE}/teachers_by_admin`, {
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
        next: { revalidate: ADMIN_TTL_MS / 1000, tags: [ADMIN_LIST_TAG] },
      });
      if (res.ok) break;
      lastErr = new Error(`Failed to load admin list (${res.status})`);
      // Non-retryable client errors won't get better.
      if (res.status < 500 && res.status !== 429) break;
      res = null;
    } catch (err) {
      lastErr = err;
      res = null;
    }
  }
  if (!res || !res.ok) {
    if (cache) {
      console.warn(
        "[admin-auth] admin-list refresh failed; serving stale cache:",
        lastErr
      );
      return cache;
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Failed to load admin list");
  }
  const raw = (await res.json()) as RawTeacher[];
  const byEmail = new Map<string, AdminUser>();
  for (const t of raw) {
    if (t.isArchived) continue;
    if (!t.email) continue;
    const key = t.email.trim().toLowerCase();
    byEmail.set(key, {
      id: t.teacherId || key,
      email: t.email,
      name: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || t.email,
      firstName: t.firstName ?? "",
      lastName: t.lastName ?? "",
      role: t.role ?? "Admin",
      teacherId: t.teacherId ?? "",
    });
  }
  return { fetchedAt: Date.now(), byEmail };
}

async function getAdminCache(): Promise<AdminCache> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < ADMIN_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadAdmins()
    .then((c) => {
      cache = c;
      return c;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Force a refetch of the admin list (e.g. for a "Refresh admins" admin
 *  action). Drops both the in-memory copy and the Data Cache entry so
 *  the next caller pulls fresh. */
export function invalidateAdminCache() {
  cache = null;
  try {
    revalidateTag(ADMIN_LIST_TAG, { expire: 0 });
  } catch {
    // Outside a request scope (scripts) nothing is cached.
  }
}

/** Every active admin, from the same cached list `requireAdmin`
 *  checks against — one fetch, one TTL, for every surface that lists
 *  staff. */
export async function getAdminList(): Promise<AdminUser[]> {
  const c = await getAdminCache();
  return [...c.byEmail.values()];
}

/** True if the given email matches an active admin in the Xano list. */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const c = await getAdminCache();
  return c.byEmail.has(email.trim().toLowerCase());
}

/** Returns the matching `AdminUser` for the email, or null. */
export async function getAdminForEmail(
  email: string | null | undefined
): Promise<AdminUser | null> {
  if (!email) return null;
  const c = await getAdminCache();
  return c.byEmail.get(email.trim().toLowerCase()) ?? null;
}

/** Walk the Clerk user's primary + verified email addresses, returning the
 *  first one that matches an admin record. Some staff sign in with a
 *  personal email but have their org email as a secondary — this catches
 *  both. */
async function resolveAdminFromClerk(
  sessionClaims?: unknown
): Promise<AdminUser | null> {
  // Fast path: the session token carries the primary email as a custom
  // claim (see `lib/family-auth.ts`), so the common case — an admin
  // whose primary email is on the admin list — resolves with no Clerk
  // Backend API round trip. A miss still falls through to the full
  // `currentUser()` check so secondary-email admins keep working.
  const claimEmail = emailFromClaims(sessionClaims);
  if (claimEmail) {
    const match = await getAdminForEmail(claimEmail);
    if (match) {
      noteAuthMode("claims");
      return match;
    }
  }
  noteAuthMode("clerk");
  const user = await currentUser();
  if (!user) return null;
  const candidates: string[] = [];
  if (user.primaryEmailAddress?.emailAddress) {
    candidates.push(user.primaryEmailAddress.emailAddress);
  }
  for (const e of user.emailAddresses ?? []) {
    if (e.emailAddress && !candidates.includes(e.emailAddress)) {
      candidates.push(e.emailAddress);
    }
  }
  for (const email of candidates) {
    const match = await getAdminForEmail(email);
    if (match) return match;
  }
  return null;
}

/**
 * Non-throwing admin check for the *current* Clerk user — returns the
 * matching `AdminUser` or null. Use in routes that serve both admins and
 * parents (e.g. the shared scholarship-item ownership guard), where being
 * an admin grants access but not-being-one isn't itself an error.
 */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  return resolveAdminFromClerk(sessionClaims);
}

/**
 * Server-side guard for admin routes. Throws `AdminAuthError` (401 if not
 * signed in, 403 if signed in but not an admin) — call `handleAdminError`
 * in the API route's catch block to convert into a NextResponse.
 */
export async function requireAdmin(): Promise<{
  userId: string;
  admin: AdminUser;
}> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new AdminAuthError("Unauthorized", 401);
  }
  const admin = await resolveAdminFromClerk(sessionClaims);
  if (!admin) {
    throw new AdminAuthError("Forbidden — not an admin", 403);
  }
  return { userId, admin };
}

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function handleAdminError(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("Admin API error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Internal error" },
    { status: 500 }
  );
}
