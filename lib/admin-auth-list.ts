import { getAdminList, type AdminUser } from "@/lib/admin-auth";

/**
 * Sibling helper to `lib/admin-auth.ts` — exposes the cached admin
 * list as a flat array in the minimal shape the audit-trail surfaces
 * need. Reads the SAME cached list `requireAdmin` checks against
 * (`getAdminList`), so it never costs a Xano round trip of its own.
 *
 * Returned shape:
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
  let admins: AdminUser[];
  try {
    admins = await getAdminList();
  } catch {
    return [];
  }
  return admins.map((a) => {
    const n = Number(a.teacherId);
    return {
      id: a.id,
      teacherId: Number.isFinite(n) ? n : 0,
      name: a.name,
      email: a.email,
    };
  });
}

// Export the original `AdminUser` type for any caller that needs it,
// keeping this file's surface independent of `admin-auth.ts`'s
// auth-control internals.
export type { AdminUser };
