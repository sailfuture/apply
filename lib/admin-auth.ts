import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
  const res = await fetch(`${ADMIN_API_BASE}/teachers_by_admin`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to load admin list (${res.status})`);
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
 *  action). Drops the in-memory cache so the next caller pulls fresh. */
export function invalidateAdminCache() {
  cache = null;
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
async function resolveAdminFromClerk(): Promise<AdminUser | null> {
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
 * Server-side guard for admin routes. Throws `AdminAuthError` (401 if not
 * signed in, 403 if signed in but not an admin) — call `handleAdminError`
 * in the API route's catch block to convert into a NextResponse.
 */
export async function requireAdmin(): Promise<{
  userId: string;
  admin: AdminUser;
}> {
  const { userId } = await auth();
  if (!userId) {
    throw new AdminAuthError("Unauthorized", 401);
  }
  const admin = await resolveAdminFromClerk();
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
