import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";

/**
 * Admin lookup endpoint — returns a minimal `{ id, name, email }[]`
 * map of every active admin so client surfaces can resolve the
 * audit columns (e.g. `*_admin_confirm` is an integer teacher id;
 * the documents-review table looks up the matching name to render
 * "Confirmed by Hunter Thompson · 2 hr ago"). The admin cache is
 * already loaded server-side by `requireAdmin`, so this route just
 * exposes its byEmail map flattened to a list — no extra Xano hit.
 *
 * Returns ids as strings (mirrors `AdminUser.id`), but each row also
 * exposes a numeric `teacherId` parsed from the underlying string
 * for direct comparison with the int audit columns.
 */
export async function GET() {
  try {
    await requireAdmin();
    // Importing here avoids exporting the in-memory cache. The
    // admin guard above ensures only admins can hit this surface,
    // so the list of staff names doesn't leak.
    const { listActiveAdmins } = await import("@/lib/admin-auth-list");
    const admins = await listActiveAdmins();
    return NextResponse.json(admins);
  } catch (err) {
    return handleAdminError(err);
  }
}
