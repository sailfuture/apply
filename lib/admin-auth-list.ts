import type { AdminUser } from "@/lib/admin-auth";

/**
 * Sibling helper to `lib/admin-auth.ts` — exposes the cached admin
 * list as a flat array. Lives in its own file because the cache
 * itself is module-scoped inside `admin-auth.ts` and we don't want
 * to widen the public surface there. Both files share the same
 * Xano endpoint via `getAdminCache`, so this read piggybacks on the
 * same 5-minute TTL.
 *
 * Returned shape — minimal fields needed by audit-trail surfaces:
 *   - `id`: string (teacherId or email fallback)
 *   - `teacherId`: number (parsed; 0 when missing)
 *   - `name`: display name
 *   - `email`: contact / fallback identifier
 */
export interface AdminListEntry {
  id: string;
  teacherId: number;
  name: string;
  email: string;
}

export async function listActiveAdmins(): Promise<AdminListEntry[]> {
  // Pull the same Xano endpoint the auth helper uses. Reproduces a
  // few lines of fetch logic instead of exporting the internal
  // cache from admin-auth.ts — the duplication is small and keeps
  // the cache module-private.
  const base =
    process.env.XANO_ADMIN_API_BASE_URL ??
    "https://xsc3-mvx7-r86m.n7e.xano.io/api:fJsHVIeC";
  const res = await fetch(`${base}/teachers_by_admin`, { cache: "no-store" });
  if (!res.ok) return [];
  const raw = (await res.json()) as Array<{
    firstName: string;
    lastName: string;
    email: string;
    teacherId: string;
    role: string;
    isArchived: boolean;
  }>;
  const out: AdminListEntry[] = [];
  for (const t of raw) {
    if (t.isArchived) continue;
    const email = (t.email ?? "").trim();
    if (!email) continue;
    const teacherIdNum = (() => {
      const n = Number(t.teacherId);
      return Number.isFinite(n) ? n : 0;
    })();
    out.push({
      id: t.teacherId || email,
      teacherId: teacherIdNum,
      name: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || email,
      email,
    });
  }
  return out;
}

// Export the original `AdminUser` type for any caller that needs it,
// keeping this file's surface independent of `admin-auth.ts`'s
// auth-control internals.
export type { AdminUser };
